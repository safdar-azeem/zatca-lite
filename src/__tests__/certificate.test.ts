import crypto from 'crypto'
import fs from 'fs'
import { spawnSync } from 'child_process'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  assertCertificateMatchesPrivateKey,
  getCertificateMetadata,
  repairCertificate,
} from '../utils/certificate'

const keyPath = '/tmp/zatca-certificate-metadata-key.pem'
const certificatePath = '/tmp/zatca-certificate-metadata-cert.pem'
let privateKey = ''
let certificatePem = ''

beforeAll(() => {
  const keyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'secp256k1' })
  privateKey = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
  fs.writeFileSync(keyPath, privateKey)
  const generated = spawnSync(
    'openssl',
    [
      'req',
      '-new',
      '-x509',
      '-key',
      keyPath,
      '-out',
      certificatePath,
      '-days',
      '30',
      '-set_serial',
      '0x010203040506070809',
      '-subj',
      '/DC=local/DC=gov/DC=extgazt/CN=ZATCA-LITE-TEST-CA',
    ],
    { encoding: 'utf8' }
  )
  if (generated.status !== 0) throw new Error(generated.stderr)
  certificatePem = fs.readFileSync(certificatePath, 'utf8')
})

describe('certificate utilities', () => {
  it('extracts the Java SDK issuer form and decimal serial from the certificate', () => {
    const metadata = getCertificateMetadata(certificatePem)
    expect(metadata.issuerName).toBe('CN=ZATCA-LITE-TEST-CA, DC=extgazt, DC=gov, DC=local')
    expect(metadata.serialNumber).toBe(BigInt('0x010203040506070809').toString(10))
  })

  it('repairs raw, encoded, and double-encoded certificate storage formats', () => {
    const body = getCertificateMetadata(certificatePem).certificateBody
    const encodedPem = Buffer.from(certificatePem).toString('base64')
    const doubleEncodedBody = Buffer.from(body).toString('base64')
    for (const value of [body, encodedPem, doubleEncodedBody]) {
      expect(getCertificateMetadata(repairCertificate(value)).fingerprint256).toBe(
        getCertificateMetadata(certificatePem).fingerprint256
      )
    }
  })

  it('accepts a matching key and rejects a key from another CSR', () => {
    expect(() => assertCertificateMatchesPrivateKey(certificatePem, privateKey)).not.toThrow()
    const otherKey = crypto
      .generateKeyPairSync('ec', { namedCurve: 'secp256k1' })
      .privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
    expect(() => assertCertificateMatchesPrivateKey(certificatePem, otherKey)).toThrow(
      /does not match/i
    )
  })
})
