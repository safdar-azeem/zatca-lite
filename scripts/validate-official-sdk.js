const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { createZatcaLite, repairCertificate } = require('../dist')

const sdkHome = process.env.ZATCA_OFFICIAL_SDK_HOME
if (!sdkHome) {
  throw new Error('Set ZATCA_OFFICIAL_SDK_HOME to the extracted official ZATCA Java SDK directory')
}

const wrapPem = (label, value) => {
  const body = value.replace(/\s+/g, '')
  return `-----BEGIN ${label}-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`
}

const certificate = repairCertificate(
  fs.readFileSync(path.join(sdkHome, 'Data/Certificates/cert.pem'), 'utf8')
)
const privateKey = wrapPem(
  'EC PRIVATE KEY',
  fs.readFileSync(path.join(sdkHome, 'Data/Certificates/ec-secp256k1-priv-key.pem'), 'utf8')
)

const zatca = createZatcaLite()
const seller = {
    name: 'Maximum Speed Tech Supply LTD',
    taxNumber: '399999999900003',
    registrationNumber: '1010010000',
    registrationScheme: 'CRN',
    street: 'Prince Sultan',
    buildingNumber: '2322',
    district: 'Al-Murabba',
    city: 'Riyadh',
    postalCode: '23333',
    region: 'Riyadh',
    country: 'SA',
  }
const standardBuyer = {
    name: 'Fatoora Samples LTD',
    taxNumber: '399999999800003',
    street: 'Salah Al-Din',
    buildingNumber: '1111',
    district: 'Al-Murooj',
    city: 'Riyadh',
    postalCode: '12222',
    region: 'Riyadh',
    country: 'SA',
  }
const simplifiedBuyer = {
  name: 'Walk-in Customer',
  street: '',
  buildingNumber: '',
  district: '',
  city: '',
  postalCode: '',
  region: '',
  country: 'SA',
}
const items = [
    {
      name: 'Pencil',
      quantity: 2,
      unitPrice: 2,
      taxRate: 15,
      taxAmount: 0.6,
      totalAmount: 4.6,
      totalIncludesTax: true,
    },
  ]

const cases = [
  { name: 'standard invoice', subtype: '0100000', type: '388', buyer: standardBuyer },
  { name: 'simplified invoice', subtype: '0200000', type: '388', buyer: simplifiedBuyer },
  { name: 'standard credit note', subtype: '0100000', type: '381', buyer: standardBuyer },
  { name: 'simplified credit note', subtype: '0200000', type: '381', buyer: simplifiedBuyer },
]

const config = {
  environment: 'sandbox',
  seller: {
    organizationName: 'Maximum Speed Tech Supply LTD',
    taxNumber: '399999999900003',
    location: {
      address: 'Prince Sultan',
      buildingNumber: '2322',
      city: 'Riyadh',
      postalCode: '23333',
      district: 'Al-Murabba',
    },
  },
  credentials: {
    certificateId: 'official-sdk-sample',
    privateKey,
    complianceCSID: certificate,
    complianceSecret: 'local-only',
  },
}

;(async () => {
  const issueDate = new Date().toISOString()
  for (const [index, testCase] of cases.entries()) {
    const outputPath = path.join(os.tmpdir(), `zatca-lite-official-sdk-${process.pid}-${index}.xml`)
    try {
      const invoice = zatca.buildInvoice({
        invoiceNumber: `ZATCA-LITE-SDK-${index + 1}`,
        invoiceCounter: index + 1,
        uuid: `8d487816-70b8-4ade-a618-9d620b7381${String(92 + index)}`,
        issueDate,
        seller,
        buyer: testCase.buyer,
        items,
        invoiceSubtype: testCase.subtype,
        invoiceType: testCase.type,
        instructionNote: testCase.type === '381' ? 'Returned goods' : undefined,
        originalInvoiceNumber: testCase.type === '381' ? 'ORIGINAL-1' : undefined,
        originalInvoiceIssueDate: testCase.type === '381' ? '2026-06-18T12:21:28Z' : undefined,
        originalInvoiceUUID:
          testCase.type === '381' ? '8d487816-70b8-4ade-a618-9d620b738150' : undefined,
      })
    const signed = await zatca.signInvoice({ invoice, config })
    fs.writeFileSync(outputPath, signed.signedXml, { mode: 0o600 })

    const result = spawnSync(path.join(sdkHome, 'Apps/fatoora'), ['-validate', '-invoice', outputPath], {
      cwd: sdkHome,
      env: {
        ...process.env,
        FATOORA_HOME: path.join(sdkHome, 'Apps'),
        SDK_CONFIG: path.join(sdkHome, 'Configuration/config.json'),
      },
      encoding: 'utf8',
      timeout: 60_000,
    })
    const output = `${result.stdout || ''}\n${result.stderr || ''}`
    if (result.error) throw result.error
    if (!output.includes('GLOBAL VALIDATION RESULT = PASSED')) {
      throw new Error(`Official SDK rejected the ${testCase.name}:\n${output}`)
    }
    if (/\[(?:ERROR|WARN)\]/.test(output)) {
      throw new Error(`Official SDK returned ${testCase.name} validation errors or warnings:\n${output}`)
    }
    } finally {
      fs.rmSync(outputPath, { force: true })
    }
  }
  console.log(`Official ZATCA SDK validation passed without warnings for ${cases.length} invoice scenarios`)
})().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
