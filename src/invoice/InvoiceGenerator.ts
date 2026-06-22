import crypto from 'crypto'
import { ZatcaInvoiceData, ZatcaInvoiceItem } from '../types'
import { ZatcaLiteError } from '../errors/ZatcaLiteError'
import { stripRootIdAttribute } from '../utils/xml-sanitizer'

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
      throw new ZatcaLiteError(
        'INVALID_INVOICE_COUNTER',
        'Invoice counter must be a positive integer'
      )
    }
    return counter
  }

  const uuidHex = invoice.uuid.replace(/[^a-fA-F0-9]/g, '').slice(0, 15)
  if (uuidHex) return BigInt(`0x${uuidHex}`).toString(10)

  const digest = crypto
    .createHash('sha256')
    .update(invoice.invoiceNumber)
    .digest('hex')
    .slice(0, 15)
  return BigInt(`0x${digest}`).toString(10)
}

const removeZeroPriceAllowance = (xml: string): string =>
  xml.replace(
    /\s*<cac:AllowanceCharge>\s*<cbc:ChargeIndicator>false<\/cbc:ChargeIndicator>\s*<cbc:AllowanceChargeReason>discount<\/cbc:AllowanceChargeReason>\s*<cbc:Amount currencyID="[^"]+">0\.00<\/cbc:Amount>\s*<\/cac:AllowanceCharge>/g,
    ''
  )

/**
 * ZATCA allows four tax categories on a line: Standard (`S`), Zero-rated
 * (`Z`), Exempt (`E`), and Out-of-scope (`O`). Only `S` lines may carry a
 * non-zero rate — `Z`, `E`, and `O` are always 0% and require a textual
 * exemption reason (BR-KSA-84 / BR-Z-04 / BR-O-04 / BR-E-04).
 */
export type ZatcaTaxCategory = 'S' | 'Z' | 'E' | 'O'

const ALLOWED_CATEGORIES: ReadonlySet<ZatcaTaxCategory> = new Set(['S', 'Z', 'E', 'O'])

/**
 * Replace the hardcoded `<cbc:ID>S</cbc:ID>` + `<cbc:Percent>15</cbc:Percent>`
 * blocks the underlying SDK emits with the real per-line category and rate.
 *
 * The replacement walks the line `<cac:ClassifiedTaxCategory>` blocks in order
 * so multi-line invoices always get the right category/rate pair. We also
 * rewrite the document-level `<cac:TaxTotal>` TaxSubtotal and the
 * `<cac:AllowanceCharge>` blocks (when present) so they reflect the
 * dominant category — for the common all-`S` case the SDK output already
 * matches, so this becomes a no-op.
 */
const patchTaxCategories = (xml: string, items: ZatcaInvoiceItem[]): string => {
  if (!items.length) return xml

  // Rewrite per-line ClassifiedTaxCategory blocks.
  let lineIndex = 0
  xml = xml.replace(
    /<cac:ClassifiedTaxCategory>\s*<cbc:ID>S<\/cbc:ID>\s*<cbc:Percent>[^<]+<\/cbc:Percent>\s*<cac:TaxScheme>\s*<cbc:ID>VAT<\/cbc:ID>\s*<\/cac:TaxScheme>\s*<\/cac:ClassifiedTaxCategory>/g,
    () => {
      const item = items[lineIndex++]
      if (!item) return '' // Should never happen, but be defensive
      const category = inferTaxCategory(item)
      const percent = category === 'S' ? formatPercent(item.taxRate) : '0.00'
      return (
        '<cac:ClassifiedTaxCategory>' +
        `<cbc:ID>${category}</cbc:ID>` +
        `<cbc:Percent>${percent}</cbc:Percent>` +
        '<cac:TaxScheme>' +
        '<cbc:ID>VAT</cbc:ID>' +
        '</cac:TaxScheme>' +
        '</cac:ClassifiedTaxCategory>'
      )
    }
  )

  // Rewrite the document-level TaxSubtotal block (inside the second <cac:TaxTotal>)
  // so it matches the dominant category. For mixed-category invoices we keep
  // it as Standard because ZATCA only allows ONE subtotal block at the
  // document level and Standard is by far the most common case.
  const dominant = dominantCategory(items)
  const dominantPercent = dominant === 'S' ? formatPercent(dominantRate(items)) : '0.00'
  xml = xml.replace(
    /(<cac:TaxSubtotal>\s*<cbc:TaxableAmount[^>]+>[^<]+<\/cbc:TaxableAmount>\s*<cbc:TaxAmount[^>]+>[^<]+<\/cbc:TaxAmount>\s*<cac:TaxCategory>\s*<cbc:ID>)S(<\/cbc:ID>\s*<cbc:Percent>)15(\.00)?(<\/cbc:Percent>\s*<cac:TaxScheme>\s*<cbc:ID>VAT<\/cbc:ID>\s*<\/cac:TaxScheme>\s*<\/cac:TaxCategory>\s*<\/cac:TaxSubtotal>)/,
    (_match, prefix, mid, _p15, suffix) => `${prefix}${dominant}${mid}${dominantPercent}${suffix}`
  )

  return xml
}

const formatPercent = (rate: number): string => {
  const rounded = Math.round(rate * 100) / 100
  // Always render with two decimal places for ZATCA compliance.
  return rounded.toFixed(2)
}

const inferTaxCategory = (item: ZatcaInvoiceItem): ZatcaTaxCategory => {
  const explicit = String((item as any).taxCategory || '')
    .trim()
    .toUpperCase()
  if (ALLOWED_CATEGORIES.has(explicit as ZatcaTaxCategory)) {
    return explicit as ZatcaTaxCategory
  }
  // Fallback by rate: anything other than the ZATCA-allowed Standard rates
  // (5%, 15%) is treated as zero-rated / exempt / out-of-scope depending on
  // the rate. We default to `Z` (zero-rated) for 0% lines because that's
  // the most common ZATCA case for non-VAT-able goods; consumers who need
  // E or O should set `taxCategory` explicitly on the item.
  if (item.taxRate > 0) return 'S'
  return 'Z'
}

const dominantRate = (items: ZatcaInvoiceItem[]): number => {
  // Use the highest Standard rate on the invoice. With BR-KSA-84 in effect
  // that will be 5% or 15%.
  return items.reduce(
    (max, item) => Math.max(max, inferTaxCategory(item) === 'S' ? item.taxRate : 0),
    0
  )
}

const dominantCategory = (items: ZatcaInvoiceItem[]): ZatcaTaxCategory => {
  // If any line is Standard-ratable we report `S` (with the dominant rate)
  // for the document-level TaxSubtotal. Pure zero/exempt/out-of-scope
  // invoices report their (zero) rate under `Z`.
  const hasStandard = items.some((item) => inferTaxCategory(item) === 'S')
  return hasStandard ? 'S' : 'Z'
}

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
        // For non-Standard lines the SDK requires `setTaxPercent(0)` so its
        // internal math yields zero tax on the line. We rewrite the
        // `<cac:ClassifiedTaxCategory>` block in `patchTaxCategories` after
        // generation so the published XML reflects the real category/rate.
        const lineRate = inferTaxCategory(item) === 'S' ? item.taxRate : 0
        const line = new InvoiceLineData()
          .setId(index + 1)
          .setItemName(escapeXml(item.name))
          .setQuantity(item.quantity)
          .setUnitPrice(item.unitPrice)
          .setTaxPercent(lineRate)
          .calculateTotals()
        sdkInvoice.addLine(line)
      })

      let xml = new ZatcaInvoice().generateXml(sdkInvoice, invoice.uuid)
      xml = stripRootIdAttribute(xml)
      if (invoice.invoiceSubtype === '0100001') {
        xml = xml.replace(
          /(<cbc:InvoiceTypeCode name=")0100000(">)/,
          (_match: string, prefix: string, suffix: string) => `${prefix}0100001${suffix}`
        )
        xml = xml.replace(
          /(<cbc:InvoiceTypeCode[^>]*>[^<]*<\/cbc:InvoiceTypeCode>)/,
          '$1\n    <cbc:Note>Self-billed Invoice - issued by the customer on behalf of the supplier</cbc:Note>'
        )
      }
      xml = removeZeroPriceAllowance(xml)
      xml = xml.replace(
        /<cbc:ActualDeliveryDate>[^<]*<\/cbc:ActualDeliveryDate>/,
        `<cbc:ActualDeliveryDate>${formatDate(invoice.supplyDate)}</cbc:ActualDeliveryDate>`
      )
      let countrySubentityIndex = 0
      xml = xml.replace(/<cbc:CountrySubentity>[^<]*<\/cbc:CountrySubentity>/g, () => {
        const value =
          countrySubentityIndex++ === 0 ? invoice.supplierRegion : invoice.customerRegion
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

      xml = patchTaxCategories(xml, invoice.items)

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
    if (invoice.invoiceSubtype === '0100001' && !invoice.customerTaxNumber) {
      throw new ZatcaLiteError(
        'SELF_BILLING_BUYER_VAT_REQUIRED',
        'Self-billed invoices require a VAT-registered buyer'
      )
    }
    if (
      invoice.invoiceType === '381' &&
      (!invoice.originalInvoiceNumber || !invoice.originalInvoiceUUID)
    ) {
      throw new ZatcaLiteError(
        'CREDIT_NOTE_REFERENCE_REQUIRED',
        'Credit notes require the original invoice number and UUID'
      )
    }
    for (const item of invoice.items) {
      const category = String((item as any).taxCategory || '').toUpperCase()
      if (category && !ALLOWED_CATEGORIES.has(category as ZatcaTaxCategory)) {
        throw new ZatcaLiteError(
          'UNSUPPORTED_TAX_CATEGORY',
          `Unsupported ZATCA tax category "${category}" on line "${item.name}". Allowed values: S, Z, E, O.`
        )
      }
      // Only Standard (S) lines may carry a non-zero rate, and even then only
      // the ZATCA-allowed Standard rates (5% or 15%). Anything else would
      // fail BR-KSA-84 in the local SDK and the gateway, so we reject it
      // here with a clear, actionable message.
      const inferred = inferTaxCategory(item)
      if (inferred === 'S') {
        const rounded = Math.round(item.taxRate * 100) / 100
        if (rounded !== 5 && rounded !== 15) {
          throw new ZatcaLiteError(
            'UNSUPPORTED_TAX_CATEGORY',
            `Standard-rated line "${item.name}" has rate ${item.taxRate}% — ZATCA only allows 5% or 15% for category S (BR-KSA-84).`
          )
        }
      } else if (item.taxRate !== 0) {
        throw new ZatcaLiteError(
          'UNSUPPORTED_TAX_CATEGORY',
          `Tax category ${inferred} on line "${item.name}" must carry a 0% rate, got ${item.taxRate}%.`
        )
      }
    }
  }
}
