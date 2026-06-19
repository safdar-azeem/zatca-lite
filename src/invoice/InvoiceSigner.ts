import crypto from 'crypto'
import { ZatcaInvoiceData } from '../types'
import { ZatcaLiteError } from '../errors/ZatcaLiteError'
import {
  assertCertificateMatchesPrivateKey,
  getCertificateMetadata,
} from '../utils/certificate'
import { stripRootIdAttribute } from '../utils/xml-sanitizer'

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
      const metadata = getCertificateMetadata(input.certificatePem)
      assertCertificateMatchesPrivateKey(metadata.certificatePem, input.privateKeyPem)
      const certificate = new Certificate(
        metadata.certificatePem,
        input.privateKeyPem.trim(),
        ''
      )
      // Keep XAdES metadata under our control rather than relying on a
      // dependency's issuer/serial formatting. These values come from the
      // exact certificate embedded in KeyInfo and used for the signature.
      certificate.getFormattedIssuer = () => metadata.issuerName
      certificate.getSerialNumber = () => metadata.serialNumber
      const signer = SdkInvoiceSigner.signInvoice(input.xml, certificate)
      // Some upstream signing libraries inject a root-level `Id="..."` attribute
      // on the `<Invoice>` / `<CreditNote>` element so the enveloped signature
      // can reference it. ZATCA's UBL 2.1 schema rejects that attribute, so we
      // always strip it here — every consumer of `signWithMetadata` then gets a
      // UBL-compliant signed XML by construction. The local SDK validator and
      // the ZATCA gateway both pass through the sanitized version.
      const signedXml = stripRootIdAttribute(signer.getXML())
      return {
        signedXml,
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
