# 🇸🇦 zatca-lite

**A complete, developer-friendly abstraction for Saudi Arabia's ZATCA (Fatoora) E-Invoicing Phase 2.**

`zatca-lite` handles the heavy lifting of ZATCA compliance, acting as the sole implementation layer for onboarding, CSR generation, CSID acquisition, cryptographic signing, UBL 2.1 XML generation, QR code generation, and API communication for both Clearance and Reporting. Your application only needs to provide persistence, source-data mapping, and background queueing.

---

## 1. Understanding ZATCA Basics

Before writing code, you must understand how ZATCA processes invoices:

- **Environments:** ZATCA provides three environments: `SANDBOX` (developer testing), `SIMULATION` (pre-production testing), and `PRODUCTION` (live).

- **Invoice Types:**
- **Standard Invoices (Clearance):** Used for B2B (Business to Business). The buyer must have a valid 15-digit Saudi VAT number. These must be sent to ZATCA _before_ sharing with the customer.

- **Simplified Invoices (Reporting):** Used for B2C (Business to Consumer / Walk-ins). These are generated, handed to the customer, and reported to ZATCA within 24 hours.

- **The PIH Chain (Previous Invoice Hash):** ZATCA links invoices cryptographically. Every new invoice must contain the hash of the _previously submitted_ invoice. This requires strict serialization (locking) across your application so two invoices aren't processed at the exact same millisecond.

---

## 2. Prerequisites & Installation

Install the package via npm or yarn:

```bash
npm install zatca-lite
# or
yarn add zatca-lite

```

> Don't forget to follow me on [GitHub](https://github.com/safdar-azeem)!

**System Requirements:**

- Node.js runtime.
- If using the official local SDK for offline validation (highly recommended for `SANDBOX`), you must have **OpenJDK 11** installed. Newer versions (like Java 17) cannot validate the SDK's secp256k1 simplified-invoice signatures properly.

---

## 3. Core Architecture (Stores & Locks)

To integrate `zatca-lite` into your backend, you must provide three interfaces. This keeps `zatca-lite` agnostic to your specific database.

### A. `ZatcaConfigStore`

Provides the seller's legal identity, national address, environment, and cryptographic credentials to the package.

### B. `InvoiceStateStore`

Manages the PIH chain and invoice counters.

- `getPreviousHash(tenantId)`: Fetches the hash of the last successfully `REPORTED` or `CLEARED` invoice.

- `getNextInvoiceCounter(tenantId, invoiceId)`: Returns a monotonically increasing, persistent integer (ICV) for the new invoice.

- `saveSubmission(...)`: Saves the ZATCA response status, returned QR code, hash, and any API errors back to your database.

### C. `LockProvider`

Prevents race conditions. Since invoices must be chained via PIH, you must lock the submission process per tenant. A Redis-based distributed lock is highly recommended.

```typescript
import { createZatcaLite } from 'zatca-lite'

const zatca = createZatcaLite({
  stores: {
    configStore: new MyDbConfigStore(),
    invoiceStateStore: new MyDbInvoiceStateStore(),
    lockProvider: new RedisZatcaLockProvider(),
  },
})
```

---

## 4. Step-by-Step Onboarding Flow

Onboarding a seller device with ZATCA requires a strict 6-step flow. `zatca-lite` abstracts the API calls, but you must orchestrate the steps and securely save the credentials. Private keys and secrets should be encrypted at rest.

### Step 1: Save Seller Configuration

Collect the seller's legal name, 15-digit VAT Number, Registration Number (e.g., CRN), and physical Saudi address.

### Step 2: Generate CSR & Private Key

Generate the Certificate Signing Request. Generating a new CSR automatically invalidates any downstream credentials (CSIDs).

```typescript
const result = await zatca.onboarding.generateCSR({
  commonName: 'Device-01',
  organizationName: 'Saudi Seller LLC',
  organizationUnit: 'Riyadh Branch',
  country: 'SA',
  taxNumber: '300000000000003',
  location: '1234 King Road Olaya Riyadh 12345',
  envType: 'sandbox',
})
// Securely save result.csr and result.privateKey to your DB
```

### Step 3: Request Compliance CSID (Requires OTP)

The user must log into the ZATCA Fatoora Portal, generate a 6-digit OTP, and provide it to your app.

```typescript
const result = await zatca.onboarding.requestComplianceCSID(
  savedCsr,
  '123456', // The Fatoora OTP
  'sandbox'
)
// Securely save result.complianceCSID, result.complianceSecret, and result.requestId
```

### Step 4: Run Compliance Checks

Before getting production credentials, ZATCA requires you to prove you can generate compliant invoices.

```typescript
await zatca.onboarding.runComplianceCheck({
  certificateId: 'cert-1',
  privateKey: savedPrivateKey,
  csid: savedComplianceCSID,
  secret: savedComplianceSecret,
  issuerInfo: sellerConfig,
  envType: 'sandbox',
})
// Mark compliance as PASSED in your DB
```

### Step 5: Request Production CSID

Exchange the compliance credentials for live production credentials.

```typescript
const result = await zatca.onboarding.requestProductionCSID(
  savedComplianceCSID,
  savedComplianceSecret,
  savedComplianceRequestId,
  'sandbox'
)
// Securely save result.productionCSID, result.productionSecret, and result.requestId
```

### Step 6: Validate Readiness

Ensure all credentials are saved and valid. The tenant is now ready to automatically submit invoices.

---

## 5. Invoice Mapping & Rules

When bridging your system's invoices to `zatca-lite`'s `buildZatcaInvoice` payload, adhere to ZATCA's strict UBL 2.1 mathematical rules:

1. **Tax Limits:** ZATCA only accepts Standard (`S` at 15%), Zero-rated (`Z`), Exempt (`E`), or Out-of-scope (`O`) taxes. **Compound taxes are not supported** and must be strictly rejected by your mapper before generation.

2. **Tax-Exclusive Unit Prices:** Your line items must send the base, tax-exclusive price.

3. **Discounts:** Line-item discounts must be subtracted per-line _before_ applying the tax rate.

4. **UBL Root ID Sanitization:** Standard XML signers (like `xml-crypto`) inject an `Id` attribute on the root `<Invoice>` or `<CreditNote>` element. ZATCA's strict schema rejects this (`Attribute 'Id' is not allowed to appear in element 'Invoice'`). **`zatca-lite` automatically sanitizes this for you** before validation or submission.

```typescript
import { buildZatcaInvoice } from 'zatca-lite'

const invoice = buildZatcaInvoice({
  invoiceNumber: 'INV-2026-001',
  uuid: '8d487816-70b8-4ade-a618-9d620b7381b0',
  issueDate: new Date(),
  invoiceType: '388', // 388 for Invoice, 381 for Credit Note
  invoiceSubtype: isB2B ? '0100000' : '0200000', // Clearance vs Reporting
  seller: sellerConfig,
  buyer: buyerConfig, // Must include VAT Number and Address for Clearance
  items: [
    {
      name: 'Software Development Services',
      quantity: 1,
      unitPrice: 1000.0,
      taxRate: 15,
      taxAmount: 150.0,
      totalAmount: 1150.0,
      totalIncludesTax: true,
    },
  ],
})
```

---

## 6. Processing Invoices (The PIH Chain)

Never submit invoices synchronously during a user's web request. Network latency or gateway downtime will cause timeouts. Instead, push finalized invoices into an asynchronous background queue (e.g., BullMQ) with exponential retry.

In your queue worker, process the invoice:

```typescript
// zatca-lite automatically uses your LockProvider to hold the PIH chain lock,
// fetches the previous hash, increments the ICV, signs the XML, submits it
// to the ZATCA gateway, and calls your saveSubmission method.
const result = await zatca.processInvoice({
  tenantId: 'tenant-123',
  invoiceId: 'inv-456',
  invoice: mappedZatcaInvoice,
  submissionType: 'clearance', // or 'reporting'
})

console.log(`Invoice status: ${result.zatcaStatus}`) // CLEARED, REPORTED, or FAILED
```

### Handling Failures

- **Transient Errors (Retryable):** Network timeouts, HTTP 503s, or lock timeouts. Keep these in your queue and retry.

- **Validation Errors (Permanent):** E.g., Missing VAT numbers, mathematical mismatches (`BR-KSA-84`), or preflight PIH mismatch (`KSA-13`). These cannot be solved by retrying. Your `InvoiceStateStore` will mark them as `FAILED`. The user must fix the source data and re-trigger the process.

---

## 7. Local Sandbox Validation

ZATCA's official Java SDK (`fatoora` CLI) is highly recommended for `SANDBOX` environments to catch XML/cryptographic errors locally before hitting rate-limited API endpoints.

To enable local pre-flight validation in `zatca-lite`:

1. Download the official ZATCA SDK Java 238 package.

2. Set your environment variables:

- `ZATCA_CLI_PATH`: Absolute path to the `fatoora` executable.
- `ZATCA_SDK_CONFIG`: Absolute path to the SDK's `Configuration/config.json`.
- `FATOORA_HOME`: Absolute path to the `Apps` directory.
- `JAVA_HOME`: Absolute path to an **OpenJDK 11** installation.

If configured, `zatca-lite` will route your signed XML through the local Java SDK. It dynamically overrides the `pihPath` to maintain PIH validation integrity without manual out-of-band coordination, throwing a descriptive `LOCAL_SDK_VALIDATION_FAILED` error if the invoice fails validation.
