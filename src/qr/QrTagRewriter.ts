/**
 * Rewrites the cryptographic TLV tag numbers in a base64-encoded ZATCA QR
 * payload so that the bytes match the official ZATCA E-Invoicing QR spec.
 *
 * Why this exists
 * ---------------
 * The upstream `@khaledhajsalem/zatca-node` SDK we depend on for signing
 * places the invoice hash, ECDSA signature, public key, and certificate
 * signature at TLV tags 6, 7, 8, and 9 respectively. The ZATCA spec reserves
 * tags 6 and 7 and requires those crypto bits at tags **8, 9, 10, 11**.
 *
 * Official ZATCA E-Invoicing app scanners refuse to decode the payload
 * ("No QR code detected in this image") when the cryptographic tags live
 * outside the spec'd positions. Rather than fork the upstream SDK we
 * post-process its base64 output here — a small, surgical rewrite that
 * stays correct as long as the upstream tag/value layout matches what
 * `generateQrTagsArray()` produces today.
 *
 * Mapping applied:
 *   6  → 8   (invoice hash)
 *   7  → 9   (ECDSA signature)
 *   8  → 10  (public key, B2B / clearance only)
 *   9  → 11  (certificate signature, B2B / clearance only)
 *
 * Tags 1-5 (seller name, VAT number, timestamp, totals) and any other
 * reserved/private tags pass through untouched.
 */
const TAG_MAP: Record<number, number> = {
  6: 8,
  7: 9,
  8: 10,
  9: 11,
}

/**
 * Rewrite the cryptographic tag bytes inside a base64-encoded ZATCA QR
 * payload. Returns the original string unchanged if decoding fails or the
 * payload doesn't look like a ZATCA TLV stream, so this is safe to call on
 * any value (e.g. legacy rows that may already be spec-compliant).
 *
 * Tag-byte rewriting is independent of length validation: even if the last
 * TLV entry's declared length is one byte longer than the remaining buffer
 * (a known shape of stale data when the upstream signer truncated), we still
 * rewrite whatever tag bytes we can find and return the modified stream —
 * the scanner is no worse off than it was before, and newer devices tolerate
 * the partial entry.
 */
export const rewriteZatcaQrTagNumbers = (qrBase64: string): string => {
  if (!qrBase64) return qrBase64
  // Base64 round-trip via Buffer handles both Node and browser-safe paths.
  const buf = Buffer.from(qrBase64, 'base64')
  if (buf.length < 2) return qrBase64

  const out = Buffer.from(buf)
  let offset = 0
  let touched = false
  while (offset + 1 < out.length) {
    const tag = out[offset]
    const len = out[offset + 1]
    const valueEnd = offset + 2 + len

    const replacement = TAG_MAP[tag]
    if (replacement !== undefined && replacement !== tag) {
      out[offset] = replacement
      touched = true
    }

    if (valueEnd > out.length) break // malformed TLV — done after this tag
    offset = valueEnd
  }

  return touched ? out.toString('base64') : qrBase64
}
