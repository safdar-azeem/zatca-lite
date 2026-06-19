import { v4 as uuidv4 } from 'uuid'
import { GENESIS_INVOICE_HASH, INVOICE_SUBTYPES, INVOICE_TYPES } from '../constants'
import { BuildInvoiceInput, ZatcaInvoiceData, ZatcaInvoiceItem } from '../types'

function roundMoney(value: number): number {
  return Number(value.toFixed(2))
}

function normalizeItem(item: BuildInvoiceInput['items'][number]): ZatcaInvoiceItem {
  const quantity = item.quantity || 1
  const taxRate = item.taxRate ?? 15
  const totalAmount = Math.abs(item.totalAmount)
  const totalIncludesTax = item.totalIncludesTax ?? true
  const taxAmount =
    item.taxAmount ??
    (totalIncludesTax ? (totalAmount * taxRate) / (100 + taxRate) : (totalAmount * taxRate) / 100)
  const unitPrice = item.unitPrice ?? (totalAmount - taxAmount) / quantity

  const normalized: ZatcaInvoiceItem = {
    name: item.name,
    quantity,
    unitPrice: roundMoney(unitPrice),
    taxRate,
    taxAmount: roundMoney(taxAmount),
    totalAmount: roundMoney(totalAmount),
  }
  if ((item as any).taxCategory) {
    ;(normalized as any).taxCategory = (item as any).taxCategory
  }
  return normalized
}

export function buildZatcaInvoice(input: BuildInvoiceInput): ZatcaInvoiceData {
  const items = input.items.map(normalizeItem)
  const totalAmount = roundMoney(items.reduce((sum, item) => sum + item.totalAmount, 0))
  const vatAmount = roundMoney(items.reduce((sum, item) => sum + item.taxAmount, 0))
  const issueDate = input.issueDate ? new Date(input.issueDate) : new Date()
  const supplyDate = input.supplyDate ? new Date(input.supplyDate) : issueDate

  return {
    invoiceNumber: input.invoiceNumber,
    uuid: input.uuid || uuidv4(),
    issueDate,
    supplyDate,
    invoiceCounter: input.invoiceCounter,

    supplierName: input.seller.name,
    supplierTaxNumber: input.seller.taxNumber || '',
    supplierStreet: input.seller.street,
    supplierBuilding: input.seller.buildingNumber,
    supplierCity: input.seller.city,
    supplierPostalCode: input.seller.postalCode,
    supplierRegion: input.seller.region,
    supplierDistrict: input.seller.district,
    supplierCountry: input.seller.country || 'SA',
    supplierPlotIdentification: input.seller.plotIdentification,
    supplierRegistrationNumber: input.seller.registrationNumber,
    supplierRegistrationScheme: input.seller.registrationScheme,

    customerName: input.buyer.name,
    customerTaxNumber: input.buyer.taxNumber,
    customerStreet: input.buyer.street,
    customerBuilding: input.buyer.buildingNumber,
    customerCity: input.buyer.city,
    customerPostalCode: input.buyer.postalCode,
    customerRegion: input.buyer.region,
    customerDistrict: input.buyer.district,
    customerCountry: input.buyer.country || 'SA',
    customerPlotIdentification: input.buyer.plotIdentification,
    customerRegistrationNumber: input.buyer.registrationNumber,
    customerRegistrationScheme: input.buyer.registrationScheme,

    totalAmount,
    vatAmount,
    items,
    previousInvoiceHash: input.previousInvoiceHash || GENESIS_INVOICE_HASH,

    invoiceType: input.invoiceType || INVOICE_TYPES.INVOICE,
    invoiceSubtype:
      input.invoiceSubtype ||
      (input.buyer.taxNumber ? INVOICE_SUBTYPES.STANDARD : INVOICE_SUBTYPES.SIMPLIFIED),

    instructionNote: input.instructionNote,
    originalInvoiceNumber: input.originalInvoiceNumber,
    originalInvoiceIssueDate: input.originalInvoiceIssueDate
      ? new Date(input.originalInvoiceIssueDate)
      : undefined,
    originalInvoiceUUID: input.originalInvoiceUUID,
  }
}
