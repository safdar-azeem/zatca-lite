import crypto from 'crypto'
import { ZatcaInvoiceData } from '../types'
import { ZatcaLiteError } from '../errors/ZatcaLiteError'

const {
  BuyerData,
  InvoiceData,
  InvoiceLineData,
  SellerData,
  ZatcaInvoice,
} = require('@khaledhajsalem/zatca-node')

const escapeXml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const formatDate = (value: Date): string => value.toISOString().slice(0, 10)
const formatTime = (value: Date): string => value.toISOString().slice(11, 19)

const deriveNumericCounter = (invoice: ZatcaInvoiceData): string => {
  if (invoice.invoiceCounter != null) {
    const counter = String(invoice.invoiceCounter).trim()
    if (!/^\d+$/.test(counter) || BigInt(counter) < 1n) {
      throw new ZatcaLiteError('INVALID_INVOICE_COUNTER', 'Invoice counter must be a positive integer')
    }
    return counter
  }

  const uuidHex = invoice.uuid.replace(/[^a-fA-F0-9]/g, '').slice(0, 15)
  if (uuidHex) return BigInt(`0x${uuidHex}`).toString(10)

  const digest = crypto.createHash('sha256').update(invoice.invoiceNumber).digest('hex').slice(0, 15)
  return BigInt(`0x${digest}`).toString(10)
}

const removeZeroPriceAllowance = (xml: string): string =>
  xml.replace(
    /\s*<cac:AllowanceCharge>\s*<cbc:ChargeIndicator>false<\/cbc:ChargeIndicator>\s*<cbc:AllowanceChargeReason>discount<\/cbc:AllowanceChargeReason>\s*<cbc:Amount currencyID="[^"]+">0\.00<\/cbc:Amount>\s*<\/cac:AllowanceCharge>/g,
    ''
  )

export class InvoiceGenerator {
  generateXml(invoice: ZatcaInvoiceData): string {
    try {
      this.validate(invoice)

      const seller = new SellerData()
        .setRegistrationName(escapeXml(invoice.supplierName))
        .setVatNumber(escapeXml(invoice.supplierTaxNumber))
        .setPartyIdentificationId(escapeXml(invoice.supplierRegistrationScheme || 'CRN'))
        .setPartyIdentification(escapeXml(invoice.supplierRegistrationNumber))
        .setStreetName(escapeXml(invoice.supplierStreet))
        .setBuildingNumber(escapeXml(invoice.supplierBuilding))
        .setPlotIdentification(escapeXml(invoice.supplierPlotIdentification || ''))
        .setCitySubdivisionName(escapeXml(invoice.supplierDistrict || invoice.supplierRegion))
        .setCityName(escapeXml(invoice.supplierCity))
        .setPostalZone(escapeXml(invoice.supplierPostalCode))
        .setCountryCode(escapeXml(invoice.supplierCountry || 'SA'))

      const sdkInvoice = new InvoiceData()
        .setInvoiceNumber(escapeXml(invoice.invoiceNumber))
        .setIssueDate(formatDate(invoice.issueDate))
        .setDueDate(formatDate(invoice.supplyDate))
        .setIssueTime(formatTime(invoice.issueDate))
        .setDocumentCurrencyCode('SAR')
        .setTaxCurrencyCode('SAR')
        .setInvoiceCounter(deriveNumericCounter(invoice))
        .setPreviousInvoiceHash(invoice.previousInvoiceHash)
        .setSeller(seller)

      if (invoice.invoiceSubtype === '0200000') sdkInvoice.simplified()
      else sdkInvoice.standard()

      if (invoice.invoiceType === '381') {
        sdkInvoice.creditNote().addBillingReference({
          id: escapeXml(invoice.originalInvoiceNumber || ''),
          uuid: escapeXml(invoice.originalInvoiceUUID || ''),
        })
      } else {
        sdkInvoice.taxInvoice()
      }

      if (invoice.invoiceSubtype !== '0200000') {
        const buyer = new BuyerData()
          .setRegistrationName(escapeXml(invoice.customerName))
          .setVatNumber(escapeXml(invoice.customerTaxNumber || ''))
          .setPartyIdentificationId(escapeXml(invoice.customerRegistrationScheme || 'CRN'))
          .setPartyIdentification(escapeXml(invoice.customerRegistrationNumber || ''))
          .setStreetName(escapeXml(invoice.customerStreet || ''))
          .setBuildingNumber(escapeXml(invoice.customerBuilding || ''))
          .setPlotIdentification(escapeXml(invoice.customerPlotIdentification || ''))
          .setCitySubdivisionName(
            escapeXml(invoice.customerDistrict || invoice.customerRegion || '')
          )
          .setCityName(escapeXml(invoice.customerCity || ''))
          .setPostalZone(escapeXml(invoice.customerPostalCode || ''))
          .setCountryCode(escapeXml(invoice.customerCountry || 'SA'))
        sdkInvoice.setBuyer(buyer)
      }

      invoice.items.forEach((item, index) => {
        const line = new InvoiceLineData()
          .setId(index + 1)
          .setItemName(escapeXml(item.name))
          .setQuantity(item.quantity)
          .setUnitPrice(item.unitPrice)
          .setTaxPercent(item.taxRate)
          .calculateTotals()
        sdkInvoice.addLine(line)
      })

      let xml = new ZatcaInvoice().generateXml(sdkInvoice, invoice.uuid)
      xml = removeZeroPriceAllowance(xml)
      xml = xml.replace(
        /<cbc:ActualDeliveryDate>[^<]*<\/cbc:ActualDeliveryDate>/,
        `<cbc:ActualDeliveryDate>${formatDate(invoice.supplyDate)}</cbc:ActualDeliveryDate>`
      )
      let countrySubentityIndex = 0
      xml = xml.replace(/<cbc:CountrySubentity>[^<]*<\/cbc:CountrySubentity>/g, () => {
        const value = countrySubentityIndex++ === 0 ? invoice.supplierRegion : invoice.customerRegion
        return `<cbc:CountrySubentity>${escapeXml(value || '')}</cbc:CountrySubentity>`
      })
      if (invoice.invoiceSubtype !== '0200000' && !invoice.customerRegistrationNumber) {
        xml = xml.replace(
          /(<cac:AccountingCustomerParty>\s*<cac:Party>)\s*<cac:PartyIdentification>[\s\S]*?<\/cac:PartyIdentification>/,
          '$1'
        )
      }

      if (invoice.invoiceSubtype === '0200000') {
        xml = xml.replace(
          '</cac:AccountingSupplierParty>',
          '</cac:AccountingSupplierParty>\n    <cac:AccountingCustomerParty/>'
        )
      }

      return xml
    } catch (error) {
      if (error instanceof ZatcaLiteError) throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new ZatcaLiteError('XML_GENERATION_FAILED', `XML generation failed: ${message}`, error)
    }
  }

  private validate(invoice: ZatcaInvoiceData): void {
    if (!invoice.items.length) {
      throw new ZatcaLiteError('INVOICE_LINES_REQUIRED', 'At least one invoice line is required')
    }
    if (!invoice.supplierRegistrationNumber || !invoice.supplierRegistrationScheme) {
      throw new ZatcaLiteError(
        'SELLER_REGISTRATION_REQUIRED',
        'Seller registration number and ZATCA identification scheme are required'
      )
    }
    if (invoice.invoiceType === '381' && (!invoice.originalInvoiceNumber || !invoice.originalInvoiceUUID)) {
      throw new ZatcaLiteError(
        'CREDIT_NOTE_REFERENCE_REQUIRED',
        'Credit notes require the original invoice number and UUID'
      )
    }
    if (invoice.items.some((item) => item.taxRate !== 15)) {
      throw new ZatcaLiteError(
        'UNSUPPORTED_TAX_CATEGORY',
        'This package version requires 15% standard-rated lines; zero/exempt lines need an explicit ZATCA tax category and exemption reason'
      )
    }
  }
}
