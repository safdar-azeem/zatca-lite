import { describe, expect, it } from 'vitest'
import { buildZatcaInvoice } from '../mappers/canonical'

const seller = {
  name: 'Saudi Seller LLC',
  taxNumber: '300000000000003',
  registrationNumber: '1010010000',
  registrationScheme: 'CRN' as const,
  street: 'King Road',
  buildingNumber: '1234',
  city: 'Riyadh',
  postalCode: '12345',
  region: 'Riyadh',
  district: 'Olaya',
  country: 'SA',
}

const walkInBuyer = {
  name: 'Walk-in Customer',
  street: '',
  buildingNumber: '',
  district: '',
  city: '',
  postalCode: '',
  region: '',
  country: 'SA',
}

describe('buildZatcaInvoice canonical mapper', () => {
  it('drops compound tax when caller has already isolated the standard-tax total', () => {
    // Caller computed a tax-exclusive unit price and only the standard-tax
    // amount. The mapper should pass the standard-tax figures through; the
    // compound portion is intentionally dropped because ZATCA cannot
    // represent it on a single line (BR-KSA-84).
    const invoice = buildZatcaInvoice({
      invoiceNumber: 'INV-COMPOUND',
      seller,
      buyer: walkInBuyer,
      items: [
        {
          name: 'Item',
          quantity: 5,
          unitPrice: 442.5,
          taxRate: 15,
          taxAmount: 331.88,
          totalAmount: 2544.38,
          totalIncludesTax: true,
        },
      ],
      invoiceSubtype: '0200000',
      invoiceType: '388',
    })
    expect(invoice.vatAmount).toBe(331.88)
    expect(invoice.totalAmount).toBe(2544.38)
    expect(invoice.items[0].taxRate).toBe(15)
    expect(invoice.items[0].taxAmount).toBe(331.88)
  })

  it('infers tax category S from a non-zero rate and Z from a zero rate', () => {
    const mixedInvoice = buildZatcaInvoice({
      invoiceNumber: 'INV-MIXED',
      seller,
      buyer: walkInBuyer,
      items: [
        {
          name: 'Standard',
          quantity: 1,
          unitPrice: 100,
          taxRate: 15,
          taxAmount: 15,
          totalAmount: 115,
          totalIncludesTax: true,
        },
        {
          name: 'Zero-rated',
          quantity: 1,
          unitPrice: 50,
          taxRate: 0,
          taxAmount: 0,
          totalAmount: 50,
          totalIncludesTax: true,
          taxCategory: 'Z',
        },
      ],
      invoiceSubtype: '0200000',
      invoiceType: '388',
    })
    expect((mixedInvoice.items[0] as any).taxCategory).toBeUndefined() // caller didn't set, mapper infers S at runtime
    expect((mixedInvoice.items[1] as any).taxCategory).toBe('Z')
  })

  it('picks standard subtype for B2B and simplified for walk-in', () => {
    const standardInvoice = buildZatcaInvoice({
      invoiceNumber: 'INV-B2B',
      seller,
      buyer: { ...walkInBuyer, taxNumber: '300000000000003' },
      items: [
        { name: 'Item', quantity: 1, unitPrice: 100, taxRate: 15, taxAmount: 15, totalAmount: 115, totalIncludesTax: true },
      ],
      invoiceType: '388',
    })
    expect(standardInvoice.invoiceSubtype).toBe('0100000')

    const simplifiedInvoice = buildZatcaInvoice({
      invoiceNumber: 'INV-B2C',
      seller,
      buyer: walkInBuyer,
      items: [
        { name: 'Item', quantity: 1, unitPrice: 100, taxRate: 15, taxAmount: 15, totalAmount: 115, totalIncludesTax: true },
      ],
      invoiceType: '388',
    })
    expect(simplifiedInvoice.invoiceSubtype).toBe('0200000')
  })

  it('generates a UUID when none is supplied', () => {
    const invoice = buildZatcaInvoice({
      invoiceNumber: 'INV-UUID',
      seller,
      buyer: walkInBuyer,
      items: [
        { name: 'Item', quantity: 1, unitPrice: 100, taxRate: 15, taxAmount: 15, totalAmount: 115, totalIncludesTax: true },
      ],
      invoiceSubtype: '0200000',
      invoiceType: '388',
    })
    expect(invoice.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('passes through credit-note references', () => {
    const invoice = buildZatcaInvoice({
      invoiceNumber: 'CN-1',
      seller,
      buyer: { ...walkInBuyer, taxNumber: '300000000000003' },
      items: [
        { name: 'Return', quantity: 1, unitPrice: 100, taxRate: 15, taxAmount: 15, totalAmount: 115, totalIncludesTax: true },
      ],
      invoiceType: '381',
      originalInvoiceNumber: 'INV-ORIG',
      originalInvoiceUUID: '11111111-2222-3333-4444-555555555555',
      originalInvoiceIssueDate: new Date('2026-01-01T00:00:00Z'),
    })
    expect(invoice.invoiceType).toBe('381')
    expect(invoice.originalInvoiceNumber).toBe('INV-ORIG')
    expect(invoice.originalInvoiceUUID).toBe('11111111-2222-3333-4444-555555555555')
    expect(invoice.originalInvoiceIssueDate).toBeInstanceOf(Date)
  })
})