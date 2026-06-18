# zatca-lite

`zatca-lite` is a database-agnostic Node.js package for ZATCA Phase 2 onboarding, CSR generation, invoice XML generation, invoice signing, QR generation, reporting, and clearance.

It intentionally does not know about Express, GraphQL, Mongoose, Prisma, PostgreSQL, MongoDB, or any ERP document shape. Applications pass canonical invoice data and optionally provide persistence adapters.

## Install

```bash
yarn add zatca-lite
```

CSR generation requires OpenSSL to be available on the server.

The package's signed standard, simplified, standard-credit-note, and simplified-credit-note fixtures are checked with the official ZATCA Java SDK. When the SDK is installed locally:

```bash
ZATCA_OFFICIAL_SDK_HOME=/absolute/path/to/zatca-einvoicing-sdk-Java-* \
  yarn validate:official-sdk
```

Use the JDK range required by the downloaded SDK. SDK 3.4.8 requires Java 11 for simplified-signature validation; Java 17 rejects the SDK's own secp256k1 sample signature.

## Basic Usage

```ts
import { createZatcaLite } from 'zatca-lite'

const zatca = createZatcaLite()

const invoice = zatca.buildInvoice({
  invoiceNumber: 'INV-1001',
  invoiceCounter: 1,
  seller: {
    name: 'Demo Trading Co',
    taxNumber: '300000000000003',
    registrationNumber: '1010010000',
    registrationScheme: 'CRN',
    street: 'King Fahd Road',
    buildingNumber: '1234',
    city: 'Riyadh',
    postalCode: '12345',
    region: 'Riyadh',
    district: 'Olaya',
  },
  buyer: {
    name: 'Walk-in Customer',
    street: 'N/A',
    buildingNumber: '0000',
    city: 'Riyadh',
    postalCode: '00000',
    region: 'Riyadh',
  },
  items: [
    {
      name: 'Product A',
      quantity: 1,
      totalAmount: 115,
      taxRate: 15,
      totalIncludesTax: true,
    },
  ],
})

const result = await zatca.processInvoice({
  tenantId: 'enterprise-1',
  invoiceId: 'local-invoice-id',
  invoice,
  submissionType: 'reporting',
  config: {
    environment: 'simulation',
    seller: {
      organizationName: 'Demo Trading Co',
      taxNumber: '300000000000003',
      location: {
        address: 'King Fahd Road',
        buildingNumber: '1234',
        city: 'Riyadh',
        postalCode: '12345',
        district: 'Olaya',
      },
    },
    credentials: {
      certificateId: '1234567890',
      privateKey: process.env.ZATCA_PRIVATE_KEY!,
      complianceCSID: process.env.ZATCA_COMPLIANCE_CSID!,
      complianceSecret: process.env.ZATCA_COMPLIANCE_SECRET!,
    },
  },
})
```

This release deliberately rejects invoice lines outside the 15% standard VAT category. Zero-rated, exempt, and out-of-scope lines require an explicit tax-category and exemption-reason model; they are not guessed.

## Persistence Adapters

For production, provide adapters so `zatca-lite` can load config, get the previous invoice hash, persist submission results, and lock the invoice chain:

```ts
const zatca = createZatcaLite({
  stores: {
    configStore,
    invoiceStateStore,
    lockProvider,
  },
})
```

See [docs/integration.md](docs/integration.md) for adapter examples and workflow notes.
