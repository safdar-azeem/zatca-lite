import { v4 as uuidv4 } from 'uuid'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { CsrGenerator } from './CsrGenerator'
import {
  ComplianceCsidResult,
  GenerateCsrInput,
  GenerateCsrResult,
  ProductionCsidResult,
  RunComplianceCheckInput,
  ZatcaEnv,
  ZatcaLogger,
} from '../types'
import { assertCertificateMatchesPrivateKey, repairCertificate } from '../utils/certificate'
import { ZatcaLiteError } from '../errors/ZatcaLiteError'

const {
  BuyerData,
  InvoiceData,
  InvoiceLineData,
  InvoiceSigner,
  SellerData,
  ZatcaAPIService,
  ZatcaInvoice,
  ZatcaManager,
} = require('@khaledhajsalem/zatca-node')

export class OnboardingService {
  private readonly csrGenerator: CsrGenerator
  private readonly logger?: ZatcaLogger

  constructor(options: { logger?: ZatcaLogger; csrGenerator?: CsrGenerator } = {}) {
    this.logger = options.logger
    this.csrGenerator = options.csrGenerator || new CsrGenerator()
  }

  generateCSR(input: GenerateCsrInput): Promise<GenerateCsrResult> {
    return this.csrGenerator.generate(input)
  }

  async requestComplianceCSID(
    csrPem: string,
    otp: string,
    env: ZatcaEnv = 'simulation'
  ): Promise<ComplianceCsidResult> {
    if (!otp?.trim()) {
      throw new ZatcaLiteError('OTP_REQUIRED', 'OTP is required')
    }

    try {
      const apiService = new ZatcaAPIService(env)
      const result = await apiService.requestComplianceCertificate(csrPem, otp.trim())

      return {
        complianceCSID: repairCertificate(result.getCertificate()),
        complianceSecret: result.getSecret(),
        requestId: result.getRequestId(),
      }
    } catch (error) {
      throw this.wrapSdkError('COMPLIANCE_CSID_FAILED', 'ZATCA compliance CSID request failed', error)
    }
  }

  async requestProductionCSID(
    complianceCSID: string,
    complianceSecret: string,
    complianceRequestId: string,
    env: ZatcaEnv = 'simulation'
  ): Promise<ProductionCsidResult> {
    try {
      const apiService = new ZatcaAPIService(env)
      const result = await apiService.requestProductionCertificate(
        repairCertificate(complianceCSID),
        complianceSecret,
        complianceRequestId
      )

      return {
        productionCSID: repairCertificate(result.getCertificate()),
        productionSecret: result.getSecret(),
        requestId: result.getRequestId(),
      }
    } catch (error) {
      throw this.wrapSdkError('PRODUCTION_CSID_FAILED', 'ZATCA production CSID request failed', error)
    }
  }

  async runComplianceCheck(input: RunComplianceCheckInput): Promise<boolean> {
    const env = input.envType || 'simulation'
    const tempDir = os.tmpdir()
    const certPath = path.join(tempDir, `zatca_lite_cert_${Date.now()}.pem`)
    const keyPath = path.join(tempDir, `zatca_lite_key_${Date.now()}.pem`)

    try {
      const certificate = repairCertificate(input.csid)
      assertCertificateMatchesPrivateKey(certificate, input.privateKey)
      fs.writeFileSync(certPath, certificate)
      fs.writeFileSync(keyPath, input.privateKey.trim())

      const zatcaManager = new ZatcaManager({
        environment: env,
        certificate_path: certPath,
        private_key_path: keyPath,
        secret: input.secret,
      })

      let previousHash = 'MA=='
      let invoiceCounter = 1

      const seller = new SellerData()
      seller
        .setRegistrationName(input.issuerInfo.name)
        .setVatNumber(input.issuerInfo.taxNumber)
        .setPartyIdentification(input.issuerInfo.registrationNumber || '1010203020')
        .setPartyIdentificationId(input.issuerInfo.registrationScheme || 'CRN')
        .setCountryCode('SA')
        .setCityName(input.issuerInfo.location.city || 'Riyadh')
        .setStreetName(input.issuerInfo.location.address || 'Main Street')
        .setBuildingNumber(input.issuerInfo.location.buildingNumber || '1234')
        .setPostalZone(input.issuerInfo.location.postalCode || '12345')
        .setCitySubdivisionName(input.issuerInfo.location.district || 'District')

      const standardBuyer = this.createComplianceBuyer('Standard Customer', '300000000000003')
      const simplifiedBuyer = this.createComplianceBuyer('Simplified Customer')
      const testCases = [
        { type: 'standard', doc: 'invoice' },
        { type: 'standard', doc: 'credit' },
        { type: 'standard', doc: 'debit' },
        { type: 'simplified', doc: 'invoice' },
        { type: 'simplified', doc: 'credit' },
        { type: 'simplified', doc: 'debit' },
      ] as const

      const originalInvoiceNumber = `INV-${Date.now()}`
      const originalInvoiceUuid = uuidv4()

      for (const testCase of testCases) {
        const invoice = new InvoiceData()
        const now = new Date()
        const dateStr = now.toISOString().split('T')[0]
        const timeStr = now.toISOString().split('T')[1].substring(0, 8)

        invoice
          .setInvoiceNumber(`COMP-${Date.now()}-${invoiceCounter}`)
          .setIssueDate(dateStr)
          .setDueDate(dateStr)
          .setIssueTime(timeStr)
          .setCurrencyCode('SAR')
          .setDocumentCurrencyCode('SAR')
          .setTaxCurrencyCode('SAR')
          .setInvoiceCounter(invoiceCounter.toString())
          .setPreviousInvoiceHash(previousHash)
          .setSeller(seller)

        if (testCase.type === 'standard') {
          invoice.standard().setBuyer(standardBuyer)
        } else {
          invoice.simplified().setBuyer(simplifiedBuyer)
        }

        if (testCase.doc === 'invoice') {
          invoice.taxInvoice()
        } else if (testCase.doc === 'credit') {
          invoice.creditNote().addBillingReference({ id: originalInvoiceNumber, uuid: originalInvoiceUuid })
        } else {
          invoice.debitNote().addBillingReference({ id: originalInvoiceNumber, uuid: originalInvoiceUuid })
        }

        const line = new InvoiceLineData()
        line.setId(1).setItemName('Compliance Item').setQuantity(1).setUnitPrice(100).setTaxPercent(15).calculateTotals()
        invoice.addLine(line).calculateTotals()

        this.logger?.info?.('Submitting ZATCA compliance invoice', testCase)

        const uuid = uuidv4()
        const xml = new ZatcaInvoice().generateXml(invoice, uuid)
        const signer = InvoiceSigner.signInvoice(xml, zatcaManager.getCertificate())
        const signedXml = signer.getXML()
        const invoiceHash = signer.getHash()
        const response = await zatcaManager.validateInvoiceCompliance(signedXml, invoiceHash, uuid)
        const validationResults = response.validationResults || {}

        if (validationResults.status === 'ERROR' || response.status === 'ERROR') {
          throw new ZatcaLiteError(
            'COMPLIANCE_CHECK_FAILED',
            `Compliance validation failed: ${JSON.stringify(response)}`
          )
        }

        previousHash = invoiceHash
        invoiceCounter += 1
      }

      return true
    } catch (error) {
      if (error instanceof ZatcaLiteError) throw error
      throw this.wrapSdkError('COMPLIANCE_CHECK_FAILED', 'ZATCA compliance checks failed', error)
    } finally {
      try {
        if (fs.existsSync(certPath)) fs.unlinkSync(certPath)
      } catch {
        // Best effort cleanup.
      }
      try {
        if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath)
      } catch {
        // Best effort cleanup.
      }
    }
  }

  private createComplianceBuyer(name: string, vatNumber?: string): any {
    const buyer = new BuyerData()
    buyer
      .setRegistrationName(name)
      .setPartyIdentification('1010203030')
      .setPartyIdentificationId('CRN')
      .setCountryCode('SA')
      .setCityName('Jeddah')
      .setStreetName('Customer Street')
      .setBuildingNumber('4567')
      .setPostalZone('54321')
      .setCitySubdivisionName('District')

    if (vatNumber) buyer.setVatNumber(vatNumber)
    return buyer
  }

  private wrapSdkError(code: string, message: string, error: unknown): ZatcaLiteError {
    const sdkError = error as Error & { getContext?: () => unknown }
    const context = sdkError.getContext ? ` ${JSON.stringify(sdkError.getContext())}` : ''
    return new ZatcaLiteError(code, `${message}: ${sdkError.message || String(error)}${context}`, error)
  }
}
