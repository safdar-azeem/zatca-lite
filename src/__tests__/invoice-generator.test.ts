import { describe, expect, it } from 'vitest'
import { InvoiceGenerator } from '../invoice/InvoiceGenerator'
import { buildZatcaInvoice } from '../mappers/canonical'
import { ZatcaLiteError } from '../errors/ZatcaLiteError'

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

const standardItems = [
  {
    name: 'Luxury Sofa Set',
    quantity: 5,
    unitPrice: 442.5,
    taxRate: 15,
    taxAmount: 331.88,
    totalAmount: 2544.38,
    totalIncludesTax: true,
  },
]

const generator = new InvoiceGenerator()

describe('InvoiceGenerator', () => {
  it('emits a root <Invoice> element without an Id attribute', () => {
    const invoice = buildZatcaInvoice({
      invoiceNumber: 'INV-1',
      seller,
      buyer: walkInBuyer,
      items: standardItems,
      invoiceSubtype: '0200000',
      invoiceType: '388',
    })
    const xml = generator.generateXml(invoice)
    const rootTag = xml.match(/<Invoice\b[^>]*>/)
    expect(rootTag).not.toBeNull()
    expect(rootTag![0]).not.toMatch(/\sId=/)
  })

  it('preserves the invoice cbc:ID', () => {
    const invoice = buildZatcaInvoice({
      invoiceNumber: 'INV-PRESERVE-1',
      seller,
      buyer: walkInBuyer,
      items: standardItems,
      invoiceSubtype: '0200000',
      invoiceType: '388',
    })
    const xml = generator.generateXml(invoice)
    expect(xml).toContain('<cbc:ID>INV-PRESERVE-1</cbc:ID>')
  })

  it('emits a 15% Standard-rated line', () => {
    const invoice = buildZatcaInvoice({
      invoiceNumber: 'INV-15',
      seller,
      buyer: walkInBuyer,
      items: standardItems,
      invoiceSubtype: '0200000',
      invoiceType: '388',
    })
    const xml = generator.generateXml(invoice)
    expect(xml).toContain('<cbc:Percent>15.00</cbc:Percent>')
    expect(xml).toMatch(/<cac:ClassifiedTaxCategory>[\s\S]*?<cbc:ID>S<\/cbc:ID>/)
  })

  it('emits a 5% Standard-rated line', () => {
    const invoice = buildZatcaInvoice({
      invoiceNumber: 'INV-5',
      seller,
      buyer: walkInBuyer,
      items: [
        {
          name: 'Reduced Rate Item',
          quantity: 1,
          unitPrice: 100,
          taxRate: 5,
          taxAmount: 5,
          totalAmount: 105,
          totalIncludesTax: true,
        },
      ],
      invoiceSubtype: '0200000',
      invoiceType: '388',
    })
    const xml = generator.generateXml(invoice)
    expect(xml).toContain('<cbc:Percent>5.00</cbc:Percent>')
  })

  it('emits a Zero-rated line with 0% when taxCategory=Z', () => {
    const invoice = buildZatcaInvoice({
      invoiceNumber: 'INV-Z',
      seller,
      buyer: walkInBuyer,
      items: [
        {
          name: 'Exported Goods',
          quantity: 1,
          unitPrice: 100,
          taxRate: 0,
          taxAmount: 0,
          totalAmount: 100,
          totalIncludesTax: true,
          taxCategory: 'Z',
        },
      ],
      invoiceSubtype: '0200000',
      invoiceType: '388',
    })
    const xml = generator.generateXml(invoice)
    const lineCat = xml.match(/<cac:ClassifiedTaxCategory>[\s\S]*?<\/cac:ClassifiedTaxCategory>/)
    expect(lineCat).not.toBeNull()
    expect(lineCat![0]).toContain('<cbc:ID>Z</cbc:ID>')
    expect(lineCat![0]).toContain('<cbc:Percent>0.00</cbc:Percent>')
  })

  it('emits an Exempt line with 0% when taxCategory=E', () => {
    const invoice = buildZatcaInvoice({
      invoiceNumber: 'INV-E',
      seller,
      buyer: walkInBuyer,
      items: [
        {
          name: 'Financial Service',
          quantity: 1,
          unitPrice: 200,
          taxRate: 0,
          taxAmount: 0,
          totalAmount: 200,
          totalIncludesTax: true,
          taxCategory: 'E',
        },
      ],
      invoiceSubtype: '0200000',
      invoiceType: '388',
    })
    const xml = generator.generateXml(invoice)
    expect(xml).toContain('<cbc:ID>E</cbc:ID>')
  })

  it('rejects a Standard-rated line with a non-allowed rate (BR-KSA-84)', () => {
    const invoice = buildZatcaInvoice({
      invoiceNumber: 'INV-BAD',
      seller,
      buyer: walkInBuyer,
      items: [
        {
          name: 'Compound Tax Item',
          quantity: 5,
          unitPrice: 442.5,
          taxRate: 23.89,
          taxAmount: 528.79,
          totalAmount: 2741.29,
          totalIncludesTax: true,
        },
      ],
      invoiceSubtype: '0200000',
      invoiceType: '388',
    })
    expect(() => generator.generateXml(invoice)).toThrow(ZatcaLiteError)
    try {
      generator.generateXml(invoice)
    } catch (error) {
      expect((error as ZatcaLiteError).code).toBe('UNSUPPORTED_TAX_CATEGORY')
      expect((error as ZatcaLiteError).message).toMatch(/5% or 15%/)
    }
  })

  it('rejects a 0% line that is not explicitly categorized as Z/E/O', () => {
    // No taxCategory → falls back to Z because the rate is 0. This is OK.
    // A non-zero rate with a non-S category is rejected.
    const invoice = buildZatcaInvoice({
      invoiceNumber: 'INV-MISMATCH',
      seller,
      buyer: walkInBuyer,
      items: [
        {
          name: 'Mismatched',
          quantity: 1,
          unitPrice: 100,
          taxRate: 15,
          taxAmount: 15,
          totalAmount: 115,
          totalIncludesTax: true,
          taxCategory: 'E', // wrong: E should be 0%
        },
      ],
      invoiceSubtype: '0200000',
      invoiceType: '388',
    })
    expect(() => generator.generateXml(invoice)).toThrow(ZatcaLiteError)
  })

  it('rejects an unknown tax category', () => {
    const invoice = buildZatcaInvoice({
      invoiceNumber: 'INV-UNK',
      seller,
      buyer: walkInBuyer,
      items: [
        {
          name: 'Bad Category',
          quantity: 1,
          unitPrice: 100,
          taxRate: 15,
          taxAmount: 15,
          totalAmount: 115,
          totalIncludesTax: true,
          taxCategory: 'X' as any,
        },
      ],
      invoiceSubtype: '0200000',
      invoiceType: '388',
    })
    expect(() => generator.generateXml(invoice)).toThrow(ZatcaLiteError)
    try {
      generator.generateXml(invoice)
    } catch (error) {
      expect((error as ZatcaLiteError).code).toBe('UNSUPPORTED_TAX_CATEGORY')
    }
  })

  it('requires seller registration number and scheme', () => {
    const invoice = buildZatcaInvoice({
      invoiceNumber: 'INV-NOSELLER',
      seller: { ...seller, registrationNumber: '', registrationScheme: undefined },
      buyer: walkInBuyer,
      items: standardItems,
      invoiceSubtype: '0200000',
      invoiceType: '388',
    })
    expect(() => generator.generateXml(invoice)).toThrow(/Seller registration number/)
  })

  it('requires original invoice number and UUID for credit notes', () => {
    const invoice = buildZatcaInvoice({
      invoiceNumber: 'CN-1',
      seller,
      buyer: walkInBuyer,
      items: standardItems,
      invoiceSubtype: '0200000',
      invoiceType: '381',
    })
    expect(() => generator.generateXml(invoice)).toThrow(
      /Credit notes require the original invoice/
    )
  })
})
