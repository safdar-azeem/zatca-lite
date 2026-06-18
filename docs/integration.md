# zatca-lite Integration Guide

## Design

`zatca-lite` has one core rule: the package owns ZATCA workflows, while the application owns business data and persistence.

The package handles:

- CSR generation
- Compliance CSID request
- Compliance checks
- Production CSID request
- XML generation
- Invoice hash calculation
- Invoice signing
- QR generation
- Reporting
- Clearance

The application handles:

- User interface
- GraphQL or REST routes
- Database models
- Mapping local orders to canonical invoice data
- Encrypting credentials at rest
- Deciding when an invoice is eligible for submission

## Required Runtime Values

Store these values per tenant/company/enterprise:

- `environment`: `sandbox`, `simulation`, or `production`
- `certificateId`
- `privateKey`
- `complianceCSID`
- `complianceSecret`
- `complianceRequestId`
- `productionCSID`
- `productionSecret`
- `productionRequestId`
- seller legal name
- seller VAT number
- seller national address fields

Recommended environment variables for local development:

```bash
ZATCA_ENVIRONMENT=simulation
ZATCA_PRIVATE_KEY="..."
ZATCA_COMPLIANCE_CSID="..."
ZATCA_COMPLIANCE_SECRET="..."
ZATCA_PRODUCTION_CSID="..."
ZATCA_PRODUCTION_SECRET="..."
```

In production, prefer encrypted database or secret-manager storage instead of plain `.env` files.

## Onboarding Workflow

```ts
const keys = await zatca.onboarding.generateCSR({
  commonName: 'ERP POS Device',
  organizationName: 'Demo Trading Co',
  organizationUnit: 'Branch',
  taxNumber: '300000000000003',
  country: 'SA',
  location: '1234 King Fahd Road Olaya Riyadh',
  envType: 'simulation',
})

const compliance = await zatca.onboarding.requestComplianceCSID(
  keys.csr,
  otpFromFatooraPortal,
  'simulation'
)

await zatca.onboarding.runComplianceCheck({
  certificateId: keys.certificateId,
  privateKey: keys.privateKey,
  csid: compliance.complianceCSID,
  secret: compliance.complianceSecret,
  issuerInfo: {
    name: 'Demo Trading Co',
    taxNumber: '300000000000003',
    location: {
      address: 'King Fahd Road',
      buildingNumber: '1234',
      city: 'Riyadh',
      postalCode: '12345',
      district: 'Olaya',
    },
  },
  envType: 'simulation',
})

const production = await zatca.onboarding.requestProductionCSID(
  compliance.complianceCSID,
  compliance.complianceSecret,
  compliance.requestId,
  'simulation'
)
```

## Database Adapter Pattern

```ts
const configStore = {
  async getConfig(tenantId) {
    const row = await db.zatcaConfig.findUnique({ where: { tenantId } })
    if (!row) return null

    return {
      environment: row.environment,
      seller: row.seller,
      credentials: {
        certificateId: row.certificateId,
        privateKey: decrypt(row.privateKey),
        complianceCSID: decrypt(row.complianceCSID),
        complianceSecret: decrypt(row.complianceSecret),
        productionCSID: decrypt(row.productionCSID),
        productionSecret: decrypt(row.productionSecret),
      },
    }
  },
}

const invoiceStateStore = {
  async getPreviousHash(tenantId) {
    const latest = await db.zatcaInvoice.findFirst({
      where: { tenantId, invoiceHash: { not: null } },
      orderBy: { submittedAt: 'desc' },
    })

    return latest?.invoiceHash ?? null
  },

  async getNextInvoiceCounter(tenantId, invoiceId) {
    // Execute while the tenant chain lock is held. Persist the assigned value
    // on the invoice so retries always reuse the same ICV.
    return db.allocateAndPersistNextZatcaCounter(tenantId, invoiceId)
  },

  async saveSubmission(tenantId, invoiceId, result) {
    await db.invoice.update({
      where: { id: invoiceId },
      data: {
        zatcaStatus: result.zatcaStatus,
        zatcaRequestId: result.requestId,
        zatcaQrCode: result.qrCode,
        zatcaInvoiceHash: result.hash,
        zatcaSignedXmlRef: await objectStorage.putEncrypted(result.xml),
        zatcaErrors: result.zatcaErrors,
      },
    })
  },
}
```

## Chain Locking

ZATCA invoice chains are order-sensitive. Use a lock per tenant before calculating the previous hash and submitting the next invoice.

```ts
const lockProvider = {
  async withInvoiceChainLock(tenantId, work) {
    return redisLock(`zatca:${tenantId}`, work)
  },
}
```

Without a lock, two invoices created at the same time can use the same previous hash.

## ERP Integration Recommendation

Keep the application's database models and GraphQL or REST schema in the app. Integrate the package through:

- an encrypted per-tenant `configStore`
- a Finance-invoice `invoiceStateStore`
- a Redis or database `lockProvider`
- source-specific mappers behind one Finance-invoice mapper

That keeps `zatca-lite` reusable and keeps ERP-specific business rules in the ERP.

Queue processing immediately after invoice issuance. Do not wait for payment, and do not wrap external ZATCA calls in the transaction that creates the Finance invoice.
