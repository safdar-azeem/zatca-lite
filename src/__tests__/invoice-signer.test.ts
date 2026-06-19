import { describe, expect, it, vi } from 'vitest'
import crypto from 'crypto'
import fs from 'fs'
import { createZatcaLite } from '../client/ZatcaLite'
import { buildZatcaInvoice } from '../mappers/canonical'
import { InvoiceSigner } from '../invoice/InvoiceSigner'
import { InvoiceGenerator } from '../invoice/InvoiceGenerator'
import { stripRootIdAttribute } from '../utils/xml-sanitizer'
import { getCertificateMetadata, repairCertificate } from '../utils/certificate'

// Self-signed ECDSA cert (secp256k1) so the @khaledhajsalem/zatca-node signer
// can compute a valid enveloped signature without an external SDK install.
// These are throwaway values for testing only — production uses the CSR-derived
// CSID the ZATCA gateway issues during onboarding.

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

// Generate test cert/key eagerly (synchronously) at module load. We can't use
// vitest's beforeAll here because the const `config` references the cert/key
// and is captured at module-evaluation time. Generating them synchronously
// avoids that ordering trap.
function ensureTestMaterial() {
  const tmpKey = '/tmp/zatca-test-key.pem'
  const tmpCert = '/tmp/zatca-test-cert.pem'
  if (fs.existsSync(tmpKey) && fs.existsSync(tmpCert)) {
    return {
      privateKey: fs.readFileSync(tmpKey, 'utf8'),
      certPem: fs.readFileSync(tmpCert, 'utf8'),
    }
  }
  const { generateKeyPairSync } = crypto
  const keyPair = generateKeyPairSync('ec', { namedCurve: 'secp256k1' })
  const privateKey = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
  fs.writeFileSync(tmpKey, privateKey)
  const { spawnSync } = require('child_process')
  const result = spawnSync(
    'openssl',
    [
      'req',
      '-new',
      '-x509',
      '-key',
      tmpKey,
      '-out',
      tmpCert,
      '-days',
      '3650',
      '-subj',
      '/CN=zatca-lite-test',
    ],
    { encoding: 'utf8' }
  )
  if (result.status !== 0) {
    throw new Error('openssl failed: ' + result.stderr)
  }
  return {
    privateKey,
    certPem: fs.readFileSync(tmpCert, 'utf8'),
  }
}

const { privateKey: TEST_PRIVATE_KEY, certPem: TEST_CERT_PEM } = ensureTestMaterial()

const config = {
  environment: 'sandbox' as const,
  seller: {
    organizationName: 'Saudi Seller LLC',
    taxNumber: '300000000000003',
    location: {
      address: 'King Road',
      buildingNumber: '1234',
      city: 'Riyadh',
      postalCode: '12345',
      district: 'Olaya',
    },
  },
  credentials: {
    certificateId: 'test-cert',
    privateKey: TEST_PRIVATE_KEY,
    complianceCSID: repairCertificate(TEST_CERT_PEM),
    complianceSecret: 'local-only',
  },
}

describe('InvoiceSigner (signed XML passes ZATCA sanity checks)', () => {
  it('signs XML and strips any root-level Id attribute introduced by the SDK', async () => {
    const zatca = createZatcaLite()
    const invoice = buildZatcaInvoice({
      invoiceNumber: 'INV-SIGN-1',
      uuid: '8d487816-70b8-4ade-a618-9d620b738199',
      invoiceCounter: 1,
      issueDate: new Date('2026-06-18T23:22:56.796Z'),
      seller,
      buyer: walkInBuyer,
      items: standardItems,
      invoiceSubtype: '0200000',
      invoiceType: '388',
    })

    const signed = await zatca.signInvoice({ invoice, config })
    const rootTag = signed.signedXml.match(/<(?:Invoice|CreditNote)\b[^>]*>/)
    expect(rootTag).not.toBeNull()
    expect(rootTag![0]).not.toMatch(/\sId=/)
  })

  it('preserves the cbc:ID of the invoice', async () => {
    const zatca = createZatcaLite()
    const invoice = buildZatcaInvoice({
      invoiceNumber: 'INV-SIGN-PRESERVE',
      uuid: '8d487816-70b8-4ade-a618-9d620b7381a0',
      invoiceCounter: 2,
      issueDate: new Date('2026-06-18T23:22:56.796Z'),
      seller,
      buyer: walkInBuyer,
      items: standardItems,
      invoiceSubtype: '0200000',
      invoiceType: '388',
    })

    const signed = await zatca.signInvoice({ invoice, config })
    expect(signed.signedXml).toContain('<cbc:ID>INV-SIGN-PRESERVE</cbc:ID>')
  })

  it('places crypto bits at ZATCA-spec TLV tags 8/9/10/11 (not the SDK\u2019s 6/7/8/9)', async () => {
    const zatca = createZatcaLite()
    const invoice = buildZatcaInvoice({
      invoiceNumber: 'INV-SIGN-QR-TAGS',
      uuid: '8d487816-70b8-4ade-a618-9d620b7381a2',
      invoiceCounter: 4,
      issueDate: new Date('2026-06-18T23:22:56.796Z'),
      seller,
      buyer: walkInBuyer,
      items: standardItems,
      invoiceSubtype: '0200000',
      invoiceType: '388',
    })

    const signed = await zatca.signInvoice({ invoice, config })
    const buf = Buffer.from(signed.qrCode, 'base64')
    const tags: number[] = []
    let offset = 0
    while (offset + 2 <= buf.length) {
      tags.push(buf[offset])
      const len = buf[offset + 1]
      const next = offset + 2 + len
      if (next > buf.length) break
      offset = next
    }

    // Walk-in customer → simplified/0200000 → sandbox builds tags 1-9 only
    // (no public key / cert signature). The point of this test is that the
    // hash and ECDSA signature land at tags 8 and 9 — the positions the
    // official ZATCA E-Invoicing app expects.
    expect(tags.slice(0, 5)).toEqual([1, 2, 3, 4, 5])
    expect(tags).toContain(8) // invoice hash
    expect(tags).toContain(9) // ECDSA signature
    // The SDK used to emit these at 6 and 7 — must not regress.
    expect(tags).not.toContain(6)
    expect(tags).not.toContain(7)
  })

  it('produces a hash and QR code from the signed XML', async () => {
    const zatca = createZatcaLite()
    const invoice = buildZatcaInvoice({
      invoiceNumber: 'INV-SIGN-HASH',
      uuid: '8d487816-70b8-4ade-a618-9d620b7381a1',
      invoiceCounter: 3,
      issueDate: new Date('2026-06-18T23:22:56.796Z'),
      seller,
      buyer: walkInBuyer,
      items: standardItems,
      invoiceSubtype: '0200000',
      invoiceType: '388',
    })

    const signed = await zatca.signInvoice({ invoice, config })
    expect(signed.invoiceHash).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(signed.invoiceHash.length).toBeGreaterThan(20)
    expect(signed.qrCode).toBeTruthy()
    expect(signed.qrCode.length).toBeGreaterThan(20)
  })

  it('embeds issuer and serial metadata from the exact signing certificate', async () => {
    const zatca = createZatcaLite()
    const invoice = buildZatcaInvoice({
      invoiceNumber: 'INV-SIGN-X509',
      uuid: '8d487816-70b8-4ade-a618-9d620b7381a4',
      invoiceCounter: 6,
      issueDate: new Date('2026-06-18T23:22:56.796Z'),
      seller,
      buyer: walkInBuyer,
      items: standardItems,
      invoiceSubtype: '0200000',
      invoiceType: '388',
    })
    const metadata = getCertificateMetadata(TEST_CERT_PEM)
    const signed = await zatca.signInvoice({ invoice, config })

    expect(signed.signedXml).toContain(
      `<ds:X509IssuerName>${metadata.issuerName}</ds:X509IssuerName>`
    )
    expect(signed.signedXml).toContain(
      `<ds:X509SerialNumber>${metadata.serialNumber}</ds:X509SerialNumber>`
    )
    expect(signed.signedXml).toContain(metadata.certificateBody)
  })

  it('validates the final signed XML before reporting and persistence', async () => {
    const events: string[] = []
    const signedXml = '<Invoice><ds:X509Certificate>certificate</ds:X509Certificate></Invoice>'
    const invoice = buildZatcaInvoice({
      invoiceNumber: 'INV-VALIDATION-ORDER',
      uuid: '8d487816-70b8-4ade-a618-9d620b7381a5',
      invoiceCounter: 7,
      issueDate: new Date('2026-06-18T23:22:56.796Z'),
      seller,
      buyer: walkInBuyer,
      items: standardItems,
      invoiceSubtype: '0200000',
      invoiceType: '388',
    })
    const zatca = createZatcaLite({
      validators: {
        signedInvoice: {
          validate: vi.fn(async ({ signedXml: xml }) => {
            expect(xml).toBe(signedXml)
            events.push('validate')
          }),
        },
      },
      stores: {
        invoiceStateStore: {
          getPreviousHash: vi.fn().mockResolvedValue(null),
          getNextInvoiceCounter: vi.fn().mockResolvedValue(7),
          saveSubmission: vi.fn(async () => {
            events.push('save')
          }),
        },
      },
    })
    vi.spyOn(zatca, 'signInvoice').mockResolvedValue({
      invoice,
      unsignedXml: '<Invoice/>',
      signedXml,
      invoiceHash: 'hash',
      qrCode: 'qr',
    })
    vi.spyOn(zatca, 'reportInvoice').mockImplementation(async () => {
      events.push('report')
      return { requestId: 'request', zatcaStatus: 'REPORTED', zatcaErrors: [] }
    })

    await zatca.processInvoice({
      tenantId: 'tenant',
      invoiceId: 'invoice',
      invoice,
      config,
      submissionType: 'reporting',
    })
    expect(events).toEqual(['validate', 'report', 'save'])
  })

  it('always strips the root Id attribute — even if upstream signing injects one', () => {
    const fakeSigned =
      '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" Id="xmldsig-9999">' +
      '<cbc:ID>INV-X</cbc:ID></Invoice>'
    const sanitized = stripRootIdAttribute(fakeSigned)
    expect(sanitized).not.toContain('Id="xmldsig-9999"')
    expect(sanitized).toContain('<cbc:ID>INV-X</cbc:ID>')
  })

  it('sign() and signWithMetadata() both produce sanitized XML', async () => {
    // ECDSA signatures are non-deterministic — two calls produce different
    // <ds:SignatureValue> bytes for the same input. We don't compare for
    // byte-equality; instead we check that both methods produce UBL-compliant
    // XML (no root Id) and share the same structural skeleton.
    const signer = new InvoiceSigner()
    const generator = new InvoiceGenerator()
    const invoice = buildZatcaInvoice({
      invoiceNumber: 'INV-SIGN-EQ',
      uuid: '8d487816-70b8-4ade-a618-9d620b7381a2',
      invoiceCounter: 4,
      issueDate: new Date('2026-06-18T23:22:56.796Z'),
      seller,
      buyer: walkInBuyer,
      items: standardItems,
      invoiceSubtype: '0200000',
      invoiceType: '388',
    })
    const xml = generator.generateXml(invoice)

    const fromSign = await signer.sign({
      invoice,
      xml,
      certificateId: 'test',
      certificatePem: TEST_CERT_PEM,
      privateKeyPem: TEST_PRIVATE_KEY,
    })
    const fromMeta = await signer
      .signWithMetadata({
        invoice,
        xml,
        certificateId: 'test',
        certificatePem: TEST_CERT_PEM,
        privateKeyPem: TEST_PRIVATE_KEY,
      })
      .then((r) => r.signedXml)

    // Both must be sanitized — this is the property under test.
    expect(fromSign).not.toMatch(/<Invoice\b[^>]*\sId=/)
    expect(fromMeta).not.toMatch(/<Invoice\b[^>]*\sId=/)
    // Both contain the same invoice number and the same UBL signature envelope.
    expect(fromSign).toContain('<cbc:ID>INV-SIGN-EQ</cbc:ID>')
    expect(fromMeta).toContain('<cbc:ID>INV-SIGN-EQ</cbc:ID>')
    expect(fromSign).toContain('<ext:UBLExtensions>')
    expect(fromMeta).toContain('<ext:UBLExtensions>')
    expect(fromSign).toContain('<cac:Signature>')
    expect(fromMeta).toContain('<cac:Signature>')
  })

  it('signed XML never carries the root Id attribute even when injected', async () => {
    // Inject a fake `Id` into the unsigned XML — the signer must strip it
    // before returning the signed XML, so any consumer (SDK validator, ZATCA
    // gateway, persistence layer) gets compliant XML.
    const generator = new InvoiceGenerator()
    const invoice = buildZatcaInvoice({
      invoiceNumber: 'INV-SIGN-INJECT',
      uuid: '8d487816-70b8-4ade-a618-9d620b7381a3',
      invoiceCounter: 5,
      issueDate: new Date('2026-06-18T23:22:56.796Z'),
      seller,
      buyer: walkInBuyer,
      items: standardItems,
      invoiceSubtype: '0200000',
      invoiceType: '388',
    })
    const xml = generator.generateXml(invoice)
    const tampered = xml.replace('<Invoice ', '<Invoice Id="forged" ')

    const signer = new InvoiceSigner()
    const signed = await signer.signWithMetadata({
      invoice,
      xml: tampered,
      certificateId: 'test',
      certificatePem: TEST_CERT_PEM,
      privateKeyPem: TEST_PRIVATE_KEY,
    })
    expect(signed.signedXml).not.toMatch(/<Invoice\b[^>]*\sId=/)
  })
})
