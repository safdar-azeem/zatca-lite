import { describe, expect, it } from 'vitest'
import { stripRootIdAttribute } from '../utils/xml-sanitizer'

describe('ZATCA XML sanitizer', () => {
  it('removes the Id attribute that xml-crypto injects on the root Invoice element', () => {
    const signed = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" Id="xmldsig-c0f3b5d0-aaaa-bbbb-cccc-dddddddddd">',
      '    <cbc:ID>INV-2026-001</cbc:ID>',
      '    <ds:Signature Id="signature-block">',
      '        <ds:Reference URI="#xmldsig-c0f3b5d0-aaaa-bbbb-cccc-dddddddddd"/>',
      '    </ds:Signature>',
      '</Invoice>',
    ].join('\n')

    const sanitized = stripRootIdAttribute(signed)

    expect(sanitized).not.toMatch(/<Invoice\b[^>]*\sId=/)
    expect(sanitized).toMatch(/<Invoice\b[^>]*>/)
    expect(sanitized).toContain('<cbc:ID>INV-2026-001</cbc:ID>')
    // Signature block keeps its own Id — only the root must lose it.
    expect(sanitized).toContain('<ds:Signature Id="signature-block">')
  })

  it('removes the Id attribute on the root CreditNote element', () => {
    const signed =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2" Id="xmldsig-xxxx">\n' +
      '<cbc:ID>CN-1</cbc:ID></CreditNote>'
    const sanitized = stripRootIdAttribute(signed)
    expect(sanitized).not.toMatch(/<CreditNote\b[^>]*\sId=/)
    expect(sanitized).toMatch(/<CreditNote\b[^>]*>/)
  })

  it('does not strip a nested element that happens to have an Id attribute', () => {
    const signed =
      '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" Id="root-id">' +
      '<cac:AdditionalDocumentReference><cbc:ID>PIH</cbc:ID></cac:AdditionalDocumentReference>' +
      '</Invoice>'
    const sanitized = stripRootIdAttribute(signed)
    expect(sanitized).not.toContain('Id="root-id"')
    expect(sanitized).toContain('<cbc:ID>PIH</cbc:ID>')
  })

  it('is a no-op when the XML has no root Id attribute', () => {
    const clean =
      '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">' +
      '<cbc:ID>INV-1</cbc:ID></Invoice>'
    expect(stripRootIdAttribute(clean)).toBe(clean)
  })

  it('handles empty input gracefully', () => {
    expect(stripRootIdAttribute('')).toBe('')
  })
})