/**
 * ZATCA invoice XML sanitizer.
 *
 * The UBL 2.1 schema (and the official local ZATCA SDK validator) reject an
 * `Id="..."` attribute on the root `<Invoice>` or `<CreditNote>` element. Some
 * signing libraries (notably `xml-crypto`'s `SignedXml.addReference` via
 * `ensureHasId`) inject that attribute on the root so the enveloped signature
 * can reference it. ZATCA cannot accept it — the official SDK reports:
 *
 *   cvc-complex-type.3.2.2: Attribute 'Id' is not allowed to appear in
 *   element 'Invoice'.
 *
 * We strip it before the XML is returned to the caller. The `<cbc:ID>` element
 * is preserved (that's the legitimate invoice identifier), and any `Id`
 * attribute on a `<ds:Signature>` or `<ds:Reference>` block stays untouched
 * because those are required for the enveloped signature reference.
 */

const ROOT_ID_PATTERN = /(<(?:Invoice|CreditNote)\b[^>]*?)\s+Id="[^"]*"/

export const stripRootIdAttribute = (xml: string): string => {
  if (!xml) return xml
  return xml.replace(ROOT_ID_PATTERN, '$1')
}
