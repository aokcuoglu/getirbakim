export type DinamikProxyDiagnostics = {
  required: boolean
  configured: boolean
  proxyHost: string | null
  proxyPort: number | null
  proxyUser: string | null
  setupError: string | null
}
