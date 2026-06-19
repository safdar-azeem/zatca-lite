import crypto, { X509Certificate } from 'crypto'

export interface CertificateMetadata {
  certificatePem: string
  certificateBody: string
  issuerName: string
  serialNumber: string
  fingerprint256: string
}

const PEM_PATTERN = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/

const wrapCertificateBody = (body: string): string => {
  const chunks = body.match(/.{1,64}/g) || []
  return `-----BEGIN CERTIFICATE-----\n${chunks.join('\n')}\n-----END CERTIFICATE-----`
}

const certificateBodyFrom = (value: string): string => {
  const pem = value.match(PEM_PATTERN)
  return (pem ? pem[1] : value).replace(/\s+/g, '')
}

const isCertificatePem = (pem: string): boolean => {
  try {
    new X509Certificate(pem)
    return true
  } catch {
    return false
  }
}

/**
 * Normalize certificates returned by ZATCA or persisted by an application.
 *
 * ZATCA integrations commonly encounter all of these representations:
 * regular PEM, a base64 DER body, a base64-encoded body, and occasionally a
 * base64-encoded PEM string. Decode only while the result is not yet a valid
 * certificate, then return one canonical PEM representation.
 */
export function repairCertificate(cert: string): string {
  if (!cert) return cert

  let candidate = cert.trim().replace(/\\r\\n|\\n/g, '\n')
  for (let depth = 0; depth < 4; depth += 1) {
    const body = certificateBodyFrom(candidate)
    const pem = wrapCertificateBody(body)
    if (isCertificatePem(pem)) return pem

    let decoded: Buffer
    try {
      decoded = Buffer.from(body, 'base64')
    } catch {
      break
    }
    if (!decoded.length) break

    try {
      const x509 = new X509Certificate(decoded)
      return wrapCertificateBody(x509.raw.toString('base64'))
    } catch {
      candidate = decoded.toString('utf8').trim()
    }
  }

  throw new Error('Invalid X.509 certificate data')
}

/**
 * Return metadata in the same form used by the official Java SDK:
 * `X509Certificate.getIssuerDN().getName()` and a decimal BigInteger serial.
 */
export function getCertificateMetadata(certificate: string): CertificateMetadata {
  const certificatePem = repairCertificate(certificate)
  const x509 = new X509Certificate(certificatePem)
  const serialHex = x509.serialNumber.replace(/:/g, '')

  return {
    certificatePem,
    certificateBody: x509.raw.toString('base64'),
    issuerName: x509.issuer
      .split(/\r?\n/)
      .map((part) => part.trim())
      .filter(Boolean)
      .reverse()
      .join(', '),
    serialNumber: BigInt(`0x${serialHex}`).toString(10),
    fingerprint256: x509.fingerprint256,
  }
}

/** Fail before signing when onboarding stored a key from a different CSR. */
export function assertCertificateMatchesPrivateKey(
  certificate: string,
  privateKey: string
): void {
  const x509 = new X509Certificate(repairCertificate(certificate))
  const certificatePublicKey = x509.publicKey.export({ type: 'spki', format: 'der' })
  const privateKeyPublicKey = crypto
    .createPublicKey(crypto.createPrivateKey(privateKey.trim()))
    .export({ type: 'spki', format: 'der' })

  if (!Buffer.from(certificatePublicKey).equals(Buffer.from(privateKeyPublicKey))) {
    throw new Error('The private key does not match the signing certificate')
  }
}
