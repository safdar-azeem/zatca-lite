import { ZatcaInvoiceData } from '../types'
import { ZatcaLiteError } from '../errors/ZatcaLiteError'

const tlv = (tag: number, value: string): Buffer => {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.length > 255) {
    throw new ZatcaLiteError('QR_VALUE_TOO_LONG', `QR tag ${tag} exceeds 255 UTF-8 bytes`)
  }
  return Buffer.concat([Buffer.from([tag, bytes.length]), bytes])
}

export class QrCodeGenerator {
  async generate(invoice: ZatcaInvoiceData): Promise<string> {
    try {
      return Buffer.concat([
        tlv(1, invoice.supplierName),
        tlv(2, invoice.supplierTaxNumber),
        tlv(3, invoice.issueDate.toISOString()),
        tlv(4, invoice.totalAmount.toFixed(2)),
        tlv(5, invoice.vatAmount.toFixed(2)),
      ]).toString('base64')
    } catch (error) {
      if (error instanceof ZatcaLiteError) throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new ZatcaLiteError('QR_GENERATION_FAILED', `QR generation failed: ${message}`, error)
    }
  }
}
