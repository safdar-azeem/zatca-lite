export function repairCertificate(cert: string): string {
  if (!cert) return cert

  const body = cert.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s+/g, '')

  if (!body.startsWith('MII')) {
    try {
      const decoded = Buffer.from(body, 'base64').toString('utf8')

      if (decoded.startsWith('MII')) {
        const chunks = decoded.match(/.{1,64}/g) || []
        return `-----BEGIN CERTIFICATE-----\n${chunks.join('\n')}\n-----END CERTIFICATE-----`
      }
    } catch {
      // Fall through to normal PEM wrapping.
    }
  }

  const chunks = body.match(/.{1,64}/g) || []
  return `-----BEGIN CERTIFICATE-----\n${chunks.join('\n')}\n-----END CERTIFICATE-----`
}
