export type ZatcaEnv = 'sandbox' | 'simulation' | 'production'

export type ZatcaInvoiceType = '388' | '381'

export type ZatcaInvoiceSubtype = '0100000' | '0200000'

export type ZatcaSubmissionStatus = 'REPORTED' | 'CLEARED' | 'FAILED' | 'SUBMITTED' | 'PENDING'

export interface ZatcaLogger {
  debug?(message: string, meta?: unknown): void
  info?(message: string, meta?: unknown): void
  warn?(message: string, meta?: unknown): void
  error?(message: string, meta?: unknown): void
}

export interface ZatcaAddress {
  address: string
  buildingNumber: string
  city: string
  postalCode: string
  district: string
  plotIdentification?: string
  country?: string
}

export interface ZatcaParty {
  name: string
  taxNumber?: string
  registrationNumber?: string
  registrationScheme?: 'CRN' | 'MOM' | 'MLS' | '700' | 'SAG' | 'NAT' | 'GCC' | 'IQA' | 'PAS' | 'OTH'
  street: string
  buildingNumber: string
  city: string
  postalCode: string
  region: string
  district?: string
  plotIdentification?: string
  country?: string
}

export interface ZatcaCredentialSet {
  certificateId: string
  privateKey: string
  complianceCSID?: string
  complianceSecret?: string
  complianceRequestId?: string
  productionCSID?: string
  productionSecret?: string
  productionRequestId?: string
}

export interface ZatcaConfig {
  environment: ZatcaEnv
  seller: {
    organizationName: string
    taxNumber: string
    registrationNumber?: string
    registrationScheme?: ZatcaParty['registrationScheme']
    location: ZatcaAddress
  }
  credentials: ZatcaCredentialSet
  isCompliancePassed?: boolean
}

export interface ZatcaInvoiceItem {
  name: string
  quantity: number
  unitPrice: number
  taxRate: number
  taxAmount: number
  totalAmount: number
  /**
   * Optional ZATCA tax category for the line. Allowed values are `S`
   * (Standard — 5% or 15%), `Z` (Zero-rated), `E` (Exempt), and `O`
   * (Out-of-scope). When omitted, the generator infers from the rate:
   * a non-zero rate is treated as Standard and a zero rate is treated as
   * Zero-rated.
   */
  taxCategory?: 'S' | 'Z' | 'E' | 'O'
}

export interface ZatcaInvoiceData {
  invoiceNumber: string
  uuid: string
  issueDate: Date
  supplyDate: Date
  invoiceCounter?: string | number

  supplierName: string
  supplierTaxNumber: string
  supplierStreet: string
  supplierBuilding: string
  supplierCity: string
  supplierPostalCode: string
  supplierRegion: string
  supplierDistrict?: string
  supplierCountry?: string
  supplierPlotIdentification?: string
  supplierRegistrationNumber?: string
  supplierRegistrationScheme?: string

  customerName: string
  customerTaxNumber?: string
  customerStreet?: string
  customerBuilding?: string
  customerCity?: string
  customerPostalCode?: string
  customerRegion?: string
  customerDistrict?: string
  customerCountry?: string
  customerPlotIdentification?: string
  customerRegistrationNumber?: string
  customerRegistrationScheme?: string

  totalAmount: number
  vatAmount: number
  items: ZatcaInvoiceItem[]
  previousInvoiceHash: string

  invoiceType?: ZatcaInvoiceType
  invoiceSubtype?: ZatcaInvoiceSubtype

  instructionNote?: string
  originalInvoiceNumber?: string
  originalInvoiceIssueDate?: Date
  originalInvoiceUUID?: string
}

export interface ZatcaSubmissionResult {
  xml: string
  hash: string
  qrCode: string
  requestId: string
  zatcaStatus: ZatcaSubmissionStatus
  zatcaErrors: string[]
  rawResponse?: unknown
}

export interface SignedInvoiceResult {
  invoice: ZatcaInvoiceData
  unsignedXml: string
  signedXml: string
  invoiceHash: string
  qrCode: string
}

export interface SubmitResult {
  requestId: string
  zatcaStatus: ZatcaSubmissionStatus
  zatcaErrors: string[]
  rawResponse?: unknown
}

export interface ZatcaConfigStore {
  getConfig(tenantId: string): Promise<ZatcaConfig | null>
  saveConfig?(tenantId: string, config: Partial<ZatcaConfig>): Promise<void>
}

export interface InvoiceStateStore {
  getPreviousHash(tenantId: string): Promise<string | null>
  getNextInvoiceCounter?(tenantId: string, invoiceId: string): Promise<string | number>
  saveSubmission(
    tenantId: string,
    invoiceId: string,
    result: ZatcaSubmissionResult
  ): Promise<void>
}

export interface LockProvider {
  withInvoiceChainLock<T>(tenantId: string, work: () => Promise<T>): Promise<T>
}

export interface ZatcaLiteStores {
  configStore?: ZatcaConfigStore
  invoiceStateStore?: InvoiceStateStore
  lockProvider?: LockProvider
}

export interface SignedInvoiceValidator {
  validate(signedXml: string): Promise<void>
}

export interface ZatcaLiteValidators {
  signedInvoice?: SignedInvoiceValidator
}

export interface ZatcaLiteOptions {
  stores?: ZatcaLiteStores
  validators?: ZatcaLiteValidators
  logger?: ZatcaLogger
}

export interface GenerateCsrInput {
  commonName: string
  organizationName: string
  organizationUnit: string
  country?: string
  taxNumber: string
  location: string
  envType: ZatcaEnv
  industry?: string
  opensslPath?: string
}

export interface GenerateCsrResult {
  csr: string
  certificateId: string
  privateKey: string
}

export interface ComplianceCsidResult {
  complianceCSID: string
  complianceSecret: string
  requestId: string
}

export interface ProductionCsidResult {
  productionCSID: string
  productionSecret: string
  requestId: string
}

export interface RunComplianceCheckInput {
  certificateId: string
  privateKey: string
  csid: string
  secret: string
  issuerInfo: {
    name: string
    taxNumber: string
    registrationNumber?: string
    registrationScheme?: ZatcaParty['registrationScheme']
    location: Partial<ZatcaAddress>
  }
  envType?: ZatcaEnv
}

export interface BuildInvoiceInput {
  invoiceNumber: string
  uuid?: string
  invoiceCounter?: string | number
  issueDate?: Date | string
  supplyDate?: Date | string
  seller: ZatcaParty
  buyer: ZatcaParty
  items: Array<{
    name: string
    quantity: number
    unitPrice?: number
    taxRate?: number
    taxAmount?: number
    totalAmount: number
    totalIncludesTax?: boolean
    /**
     * Optional ZATCA tax category (`S`, `Z`, `E`, `O`). When omitted the
     * generator infers from the rate: a non-zero rate is treated as `S` and
     * a zero rate is treated as `Z`.
     */
    taxCategory?: 'S' | 'Z' | 'E' | 'O'
  }>
  previousInvoiceHash?: string
  invoiceType?: ZatcaInvoiceType
  invoiceSubtype?: ZatcaInvoiceSubtype
  instructionNote?: string
  originalInvoiceNumber?: string
  originalInvoiceIssueDate?: Date | string
  originalInvoiceUUID?: string
}

export interface SignInvoiceInput {
  invoice: ZatcaInvoiceData
  config?: ZatcaConfig
  tenantId?: string
}

export interface ProcessInvoiceInput {
  tenantId: string
  invoiceId: string
  invoice: ZatcaInvoiceData
  config?: ZatcaConfig
  submissionType: 'reporting' | 'clearance'
}
