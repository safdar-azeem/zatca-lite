import { ClearanceGateway } from '../api/ClearanceGateway'
import { ReportingGateway } from '../api/ReportingGateway'
import { GENESIS_INVOICE_HASH } from '../constants'
import { NoopLockProvider } from '../contracts/NoopLockProvider'
import { ZatcaLiteError } from '../errors/ZatcaLiteError'
import { InvoiceGenerator } from '../invoice/InvoiceGenerator'
import { InvoiceSigner } from '../invoice/InvoiceSigner'
import { buildZatcaInvoice } from '../mappers/canonical'
import { OnboardingService } from '../onboarding/OnboardingService'
import { QrCodeGenerator } from '../qr/QrCodeGenerator'
import {
  BuildInvoiceInput,
  ProcessInvoiceInput,
  SignedInvoiceResult,
  SignInvoiceInput,
  SubmitResult,
  ZatcaConfig,
  ZatcaLiteOptions,
  ZatcaSubmissionResult,
} from '../types'

export class ZatcaLite {
  readonly onboarding: OnboardingService
  readonly xml: InvoiceGenerator
  readonly signer: InvoiceSigner
  readonly qr: QrCodeGenerator
  readonly reporting: ReportingGateway
  readonly clearance: ClearanceGateway

  private readonly options: ZatcaLiteOptions

  constructor(options: ZatcaLiteOptions = {}) {
    this.options = options
    this.onboarding = new OnboardingService({ logger: options.logger })
    this.xml = new InvoiceGenerator()
    this.signer = new InvoiceSigner()
    this.qr = new QrCodeGenerator()
    this.reporting = new ReportingGateway()
    this.clearance = new ClearanceGateway()
  }

  buildInvoice(input: BuildInvoiceInput) {
    return buildZatcaInvoice(input)
  }

  async signInvoice(input: SignInvoiceInput): Promise<SignedInvoiceResult> {
    const config = await this.resolveConfig(input.tenantId, input.config)
    const certificate = this.getSigningCertificate(config)
    const unsignedXml = this.xml.generateXml(input.invoice)
    const signature = await this.signer.signWithMetadata({
      invoice: input.invoice,
      xml: unsignedXml,
      certificateId: config.credentials.certificateId,
      certificatePem: certificate,
      privateKeyPem: config.credentials.privateKey,
    })

    return {
      invoice: input.invoice,
      unsignedXml,
      signedXml: signature.signedXml,
      invoiceHash: signature.invoiceHash,
      qrCode: signature.qrCode,
    }
  }

  async reportInvoice(input: SignInvoiceInput & { signedXml?: string }): Promise<SubmitResult> {
    const config = await this.resolveConfig(input.tenantId, input.config)
    const token = this.getSubmissionToken(config)
    const certificatePem = this.getSigningCertificate(config)
    const signed = input.signedXml
      ? {
          signedXml: input.signedXml,
          invoiceHash: this.signer.calculateHash(input.invoice, input.signedXml),
        }
      : await this.signInvoice({ invoice: input.invoice, config })

    return this.reporting.submit({
      invoice: input.invoice,
      signedXml: signed.signedXml,
      invoiceHash: signed.invoiceHash,
      certificatePem,
      token,
      environment: config.environment,
    })
  }

  async clearInvoice(input: SignInvoiceInput & { signedXml?: string }): Promise<SubmitResult> {
    const config = await this.resolveConfig(input.tenantId, input.config)
    const token = this.getSubmissionToken(config)
    const certificatePem = this.getSigningCertificate(config)
    const signed = input.signedXml
      ? {
          signedXml: input.signedXml,
          invoiceHash: this.signer.calculateHash(input.invoice, input.signedXml),
        }
      : await this.signInvoice({ invoice: input.invoice, config })

    return this.clearance.submit({
      invoice: input.invoice,
      signedXml: signed.signedXml,
      invoiceHash: signed.invoiceHash,
      certificatePem,
      token,
      environment: config.environment,
    })
  }

  async processInvoice(input: ProcessInvoiceInput): Promise<ZatcaSubmissionResult> {
    const lockProvider = this.options.stores?.lockProvider || new NoopLockProvider()

    return lockProvider.withInvoiceChainLock(input.tenantId, async () => {
      const config = await this.resolveConfig(input.tenantId, input.config)
      const previousHash =
        (await this.options.stores?.invoiceStateStore?.getPreviousHash(input.tenantId)) ||
        input.invoice.previousInvoiceHash ||
        GENESIS_INVOICE_HASH
      const invoiceCounter =
        (await this.options.stores?.invoiceStateStore?.getNextInvoiceCounter?.(
          input.tenantId,
          input.invoiceId
        )) ||
        input.invoice.invoiceCounter

      const invoice = {
        ...input.invoice,
        previousInvoiceHash: previousHash,
        invoiceCounter,
      }

      const signed = await this.signInvoice({ invoice, config })
      // Run consumers such as the official local SDK against the final signed
      // XML before any reporting/clearance request leaves the process.
      await this.options.validators?.signedInvoice?.validate(signed.signedXml)
      const submission =
        input.submissionType === 'clearance'
          ? await this.clearInvoice({ invoice, config, signedXml: signed.signedXml })
          : await this.reportInvoice({ invoice, config, signedXml: signed.signedXml })

      const result: ZatcaSubmissionResult = {
        xml: signed.signedXml,
        hash: signed.invoiceHash,
        qrCode: signed.qrCode,
        requestId: submission.requestId,
        zatcaStatus: submission.zatcaStatus,
        zatcaErrors: submission.zatcaErrors,
        rawResponse: submission.rawResponse,
      }

      await this.options.stores?.invoiceStateStore?.saveSubmission(
        input.tenantId,
        input.invoiceId,
        result
      )

      return result
    })
  }

  private async resolveConfig(tenantId?: string, config?: ZatcaConfig): Promise<ZatcaConfig> {
    if (config) return config

    if (!tenantId || !this.options.stores?.configStore) {
      throw new ZatcaLiteError(
        'CONFIG_REQUIRED',
        'Provide config directly or configure a ZatcaConfigStore with a tenantId'
      )
    }

    const storedConfig = await this.options.stores.configStore.getConfig(tenantId)
    if (!storedConfig) {
      throw new ZatcaLiteError('CONFIG_NOT_FOUND', `No ZATCA config found for tenant ${tenantId}`)
    }

    return storedConfig
  }

  private getSigningCertificate(config: ZatcaConfig): string {
    const certificate =
      config.environment === 'production'
        ? config.credentials.productionCSID
        : config.credentials.complianceCSID

    if (!certificate) {
      throw new ZatcaLiteError(
        'CERTIFICATE_REQUIRED',
        `Missing CSID certificate for ${config.environment}`
      )
    }

    return certificate
  }

  private getSubmissionToken(config: ZatcaConfig): string {
    const token =
      config.environment === 'production'
        ? config.credentials.productionSecret
        : config.credentials.complianceSecret

    if (!token) {
      throw new ZatcaLiteError(
        'SECRET_REQUIRED',
        `Missing ZATCA secret token for ${config.environment}`
      )
    }

    return token
  }
}

export function createZatcaLite(options: ZatcaLiteOptions = {}): ZatcaLite {
  return new ZatcaLite(options)
}
