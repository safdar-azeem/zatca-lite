import { SubmitResult, ZatcaEnv, ZatcaInvoiceData } from '../types'
import { ZatcaLiteError } from '../errors/ZatcaLiteError'
import { repairCertificate } from '../utils/certificate'

const { ZatcaAPIService } = require('@khaledhajsalem/zatca-node')

const validationMessages = (response: any): string[] => {
  const validation = response?.validationResults || {}
  return [...(validation.errorMessages || []), ...(validation.warningMessages || [])]
    .map((entry: any) => entry?.message || entry?.code || String(entry))
    .filter(Boolean)
}

export class ReportingGateway {
  async submit(input: {
    invoice: ZatcaInvoiceData
    signedXml: string
    invoiceHash: string
    certificatePem: string
    token: string
    environment: ZatcaEnv
  }): Promise<SubmitResult> {
    if (input.environment === 'sandbox') {
      return {
        requestId: `SANDBOX-REPORT-${Date.now()}`,
        zatcaStatus: 'REPORTED',
        zatcaErrors: [],
      }
    }

    try {
      const rawResponse = await new ZatcaAPIService(input.environment).reportInvoice(
        repairCertificate(input.certificatePem),
        input.token,
        input.signedXml,
        input.invoiceHash,
        input.invoice.uuid
      )
      const status = rawResponse.reportingStatus || rawResponse.status
      const errors = validationMessages(rawResponse)

      return {
        requestId: rawResponse.requestID || rawResponse.requestId || '',
        zatcaStatus: status === 'REPORTED' ? 'REPORTED' : 'FAILED',
        zatcaErrors: errors.length
          ? errors
          : status === 'REPORTED'
            ? []
            : ['ZATCA did not report the invoice'],
        rawResponse,
      }
    } catch (error) {
      throw this.wrapApiError('REPORTING_FAILED', 'ZATCA reporting failed', error)
    }
  }

  private wrapApiError(code: string, message: string, error: unknown): ZatcaLiteError {
    const apiError = error as Error & { getContext?: () => unknown; details?: unknown }
    const context = apiError.getContext?.() || apiError.details
    const details = context ? ` ${JSON.stringify(context)}` : ''
    return new ZatcaLiteError(
      code,
      `${message}: ${apiError.message || String(error)}${details}`,
      error
    )
  }
}
