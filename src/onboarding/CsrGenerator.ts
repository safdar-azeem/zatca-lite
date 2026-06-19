import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { csrTemplate } from './CsrTemplate'
import { GenerateCsrInput, GenerateCsrResult } from '../types'
import { ZatcaLiteError } from '../errors/ZatcaLiteError'

const execFileAsync = promisify(execFile)

function getTemplateName(envType: GenerateCsrInput['envType']): string {
  if (envType === 'sandbox') return 'TSTZATCA-Code-Signing'
  if (envType === 'production') return 'ZATCA-Code-Signing'
  return 'PREZATCA-Code-Signing'
}

export class CsrGenerator {
  async generate(input: GenerateCsrInput): Promise<GenerateCsrResult> {
    const timestamp = Date.now()
    const tempDir = path.join(os.tmpdir(), `zatca_lite_${timestamp}`)
    const privateKeyPath = path.join(tempDir, 'private.pem')
    const configPath = path.join(tempDir, 'csr.cnf')
    const csrPath = path.join(tempDir, 'request.csr')
    const opensslPath = input.opensslPath || 'openssl'

    try {
      await fs.mkdir(tempDir, { recursive: true })

      const solutionName = input.commonName.trim()
      const cleanLocation = input.location
        .replace(/[\x00-\x1F\x7F]/g, '')
        .trim()
        .slice(0, 100)
      const certificateId = timestamp.toString().slice(-10)
      const serialNumber = `1-${solutionName}|2-Model01|3-${certificateId}`

      await fs.writeFile(
        configPath,
        csrTemplate({
          commonName: solutionName,
          organizationName: input.organizationName,
          organizationUnit: input.organizationUnit,
          taxNumber: input.taxNumber,
          country: input.country || 'SA',
          location: cleanLocation,
          industry: input.industry || 'Supply of Goods',
          templateName: getTemplateName(input.envType),
          serialNumber,
        }),
        'utf8'
      )

      await execFileAsync(opensslPath, [
        'ecparam',
        '-name',
        'prime256v1',
        '-genkey',
        '-noout',
        '-out',
        privateKeyPath,
      ])

      await execFileAsync(opensslPath, [
        'req',
        '-new',
        '-sha256',
        '-key',
        privateKeyPath,
        '-extensions',
        'v3_req',
        '-config',
        configPath,
        '-out',
        csrPath,
        '-utf8',
      ])

      const [privateKey, csr] = await Promise.all([
        fs.readFile(privateKeyPath, 'utf8'),
        fs.readFile(csrPath, 'utf8'),
      ])

      return {
        csr: csr.trim(),
        certificateId,
        privateKey: privateKey.trim(),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new ZatcaLiteError(
        'CSR_GENERATION_FAILED',
        `OpenSSL CSR generation failed: ${message}`,
        error
      )
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
