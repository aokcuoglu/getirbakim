type HeaderSource = {
  get(name: string): string | null
}

function normalizeUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/$/, '')
  }

  if (/^[a-z0-9.-]+$/i.test(trimmed)) {
    return `https://${trimmed.replace(/\/$/, '')}`
  }

  return null
}

export function getConfiguredSiteUrl(): string | null {
  return (
    normalizeUrl(process.env.NEXT_PUBLIC_SITE_URL) ||
    normalizeUrl(process.env.NEXT_PUBLIC_APP_URL) ||
    normalizeUrl(process.env.VERCEL_URL)
  )
}

export function getRequestOrigin(headers: HeaderSource | null | undefined): string | null {
  if (!headers) return null

  const forwardedHost = headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const host = forwardedHost || headers.get('host')?.split(',')[0]?.trim()
  if (!host) return null

  const forwardedProto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const protocol = forwardedProto || (host.includes('localhost') ? 'http' : 'https')

  return normalizeUrl(`${protocol}://${host}`)
}

export function isIndexingAllowed(): boolean {
  const value = process.env.NEXT_PUBLIC_ALLOW_INDEXING?.trim().toLowerCase()
  return value === 'true' || value === '1'
}

export function resolveSiteUrl(options?: {
  headers?: HeaderSource | null
  preferRequestOrigin?: boolean
}): string {
  const requestOrigin = getRequestOrigin(options?.headers)
  const configured = getConfiguredSiteUrl()

  if (options?.preferRequestOrigin) {
    return requestOrigin || configured || 'http://localhost:3000'
  }

  return configured || requestOrigin || 'http://localhost:3000'
}
