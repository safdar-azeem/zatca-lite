export interface CsrTemplateOptions {
  commonName: string
  organizationName: string
  organizationUnit: string
  taxNumber: string
  country: string
  location: string
  industry: string
  templateName: string
  serialNumber: string
}

export const csrTemplate = (opts: CsrTemplateOptions): string => `
[req]
prompt = no
utf8 = yes
distinguished_name = my_req_dn_prompt
req_extensions = v3_req

[ v3_req ]
1.3.6.1.4.1.311.20.2 = ASN1:UTF8String:${opts.templateName}
subjectAltName=dirName:dir_sect

[ dir_sect ]
SN = ${opts.serialNumber}
UID = ${opts.taxNumber}
title = 1100
registeredAddress = ${opts.location}
businessCategory = ${opts.industry}

[ my_req_dn_prompt ]
commonName = ${opts.commonName}
organizationalUnitName = ${opts.organizationUnit}
organizationName = ${opts.organizationName}
countryName = ${opts.country}
`
