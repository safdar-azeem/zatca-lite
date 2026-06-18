import crypto from 'crypto'
import { ZatcaInvoiceData } from '../types'
import { ZatcaLiteError } from '../errors/ZatcaLiteError'
import { repairCertificate } from '../utils/certificate'

const { Certificate, InvoiceExtension, InvoiceSigner: SdkInvoiceSigner } = require(
  '@khaledhajsalem/zatca-node'
)

export interface InvoiceSignatureResult {
  signedXml: string
  invoiceHash: string
  qrCode: string
}

export class InvoiceSigner {
  calculateHash(_invoice: ZatcaInvoiceData, xml: string): string {
    try {
      const xmlDom = InvoiceExtension.fromString(xml)
      xmlDom.removeByXpath('ext:UBLExtensions')
      xmlDom.removeByXpath('cac:Signature')
      xmlDom.removeParentByXpath('cac:AdditionalDocumentReference/cbc:ID[. = "QR"]')
      return crypto.createHash('sha256').update(xmlDom.canonicalize()).digest('base64')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new ZatcaLiteError('HASH_CALCULATION_FAILED', `Hash calculation failed: ${message}`, error)
    }
  }

  async signWithMetadata(input: {
    invoice: ZatcaInvoiceData
    xml: string
    certificateId: string
    certificatePem: string
    privateKeyPem: string
  }): Promise<InvoiceSignatureResult> {
    try {
      const certificate = new Certificate(
        repairCertificate(input.certificatePem),
        input.privateKeyPem.trim(),
        ''
      )
      const signer = SdkInvoiceSigner.signInvoice(input.xml, certificate)
      return {
        signedXml: signer.getXML(),
        invoiceHash: signer.getHash(),
        qrCode: signer.getQRCode(),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new ZatcaLiteError('INVOICE_SIGNING_FAILED', `Invoice signing failed: ${message}`, error)
    }
  }

  async sign(input: {
    invoice: ZatcaInvoiceData
    xml: string
    certificateId: string
    certificatePem: string
    privateKeyPem: string
  }): Promise<string> {
    return (await this.signWithMetadata(input)).signedXml
  }
}
