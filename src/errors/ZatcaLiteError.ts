export class ZatcaLiteError extends Error {
  readonly code: string
  readonly cause?: unknown

  constructor(code: string, message: string, cause?: unknown) {
    super(message)
    this.name = 'ZatcaLiteError'
    this.code = code
    this.cause = cause
  }
}
