import { ZatcaEnv } from './types'

export const ZATCA_ENDPOINTS: Record<ZatcaEnv, string> = {
  sandbox: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',
  simulation: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation',
  production: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core',
}

export const INVOICE_SUBTYPES = {
  STANDARD: '0100000',
  SIMPLIFIED: '0200000',
} as const

export const INVOICE_TYPES = {
  INVOICE: '388',
  CREDIT_NOTE: '381',
} as const

export const GENESIS_INVOICE_HASH =
  'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=='
