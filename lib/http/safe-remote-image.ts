import dns from 'node:dns/promises'
import net from 'node:net'

export const REMOTE_IMAGE_MAX_BYTES = 2 * 1024 * 1024
export const REMOTE_IMAGE_FETCH_TIMEOUT_MS = 15_000
export const REMOTE_IMAGE_MAX_REDIRECTS = 3

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml'
])

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.google',
  'kubernetes.default.svc'
])

export type SafeRemoteImageResult =
  | { ok: true; buffer: Uint8Array; contentType: string }
  | { ok: false; code: string; message: string }

function normalizeContentType(raw: string | null): string | null {
  if (!raw) return null
  const base = raw.split(';')[0]?.trim().toLowerCase()
  return base || null
}

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10))
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true
  }
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

function isPrivateOrReservedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase()
  if (normalized === '::' || normalized === '::1') return true
  if (normalized.startsWith('fe80:')) return true
  if (
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fec0:')
  ) {
    return true
  }
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length)
    if (net.isIPv4(mapped)) {
      return isPrivateOrReservedIpv4(mapped)
    }
  }
  return false
}

function isBlockedIp(ip: string): boolean {
  const version = net.isIP(ip)
  if (version === 4) return isPrivateOrReservedIpv4(ip)
  if (version === 6) return isPrivateOrReservedIpv6(ip)
  return true
}

async function assertResolvablePublicHost(hostname: string): Promise<void> {
  const lower = hostname.toLowerCase()
  if (BLOCKED_HOSTNAMES.has(lower) || lower.endsWith('.localhost')) {
    throw new Error('BLOCKED_HOST')
  }
  if (lower.endsWith('.local') || lower.endsWith('.internal')) {
    throw new Error('BLOCKED_HOST')
  }

  let addresses: { address: string; family: number }[]
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new Error('DNS_FAILED')
  }

  if (addresses.length === 0) {
    throw new Error('DNS_FAILED')
  }

  for (const entry of addresses) {
    if (isBlockedIp(entry.address)) {
      throw new Error('PRIVATE_IP')
    }
  }
}

export function parseAllowedHttpImageUrl(raw: string): URL {
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    throw new Error('INVALID_URL')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('INVALID_PROTOCOL')
  }
  if (parsed.username || parsed.password) {
    throw new Error('CREDENTIALS_NOT_ALLOWED')
  }
  if (!parsed.hostname) {
    throw new Error('INVALID_URL')
  }

  const port = parsed.port ? Number.parseInt(parsed.port, 10) : null
  const defaultPort = parsed.protocol === 'https:' ? 443 : 80
  const effectivePort = port ?? defaultPort
  if (effectivePort !== 80 && effectivePort !== 443) {
    throw new Error('INVALID_PORT')
  }

  if (net.isIP(parsed.hostname) && isBlockedIp(parsed.hostname)) {
    throw new Error('PRIVATE_IP')
  }

  return parsed
}

async function readBodyWithLimit(
  response: Response,
  maxBytes: number
): Promise<Uint8Array | null> {
  const contentLength = response.headers.get('content-length')
  if (contentLength) {
    const len = Number.parseInt(contentLength, 10)
    if (!Number.isNaN(len) && len > maxBytes) {
      return null
    }
  }

  const reader = response.body?.getReader()
  if (!reader) {
    const buf = new Uint8Array(await response.arrayBuffer())
    return buf.byteLength <= maxBytes ? buf : null
  }

  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }

  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

async function fetchImageAtUrl(
  url: URL,
  referer?: string
): Promise<SafeRemoteImageResult> {
  const response = await fetch(url.toString(), {
    method: 'GET',
    redirect: 'manual',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; GetirBakimAdmin/1.0; +https://getirbakim.com)',
      Accept: 'image/webp,image/apng,image/*,*/*;q=0.8',
      ...(referer ? { Referer: referer, Origin: referer } : {})
    },
    signal: AbortSignal.timeout(REMOTE_IMAGE_FETCH_TIMEOUT_MS)
  })

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location')
    if (!location) {
      return { ok: false, code: 'FETCH_FAILED', message: 'Yönlendirme adresi alınamadı.' }
    }
    return { ok: false, code: 'REDIRECT', message: location }
  }

  if (!response.ok) {
    return {
      ok: false,
      code: 'FETCH_FAILED',
      message: `Görsel indirilemedi (HTTP ${response.status}).`
    }
  }

  const contentType = normalizeContentType(response.headers.get('content-type'))
  if (!contentType || !ALLOWED_IMAGE_TYPES.has(contentType)) {
    return {
      ok: false,
      code: 'INVALID_CONTENT_TYPE',
      message: 'URL geçerli bir görsel dosyası döndürmüyor.'
    }
  }

  const buffer = await readBodyWithLimit(response, REMOTE_IMAGE_MAX_BYTES)
  if (!buffer) {
    return {
      ok: false,
      code: 'FILE_TOO_LARGE',
      message: 'Görsel en fazla 2 MB olabilir.'
    }
  }

  if (buffer.byteLength === 0) {
    return { ok: false, code: 'EMPTY_FILE', message: 'Görsel dosyası boş.' }
  }

  return { ok: true, buffer, contentType }
}

export async function fetchSafeRemoteImage(
  rawUrl: string,
  options?: { referer?: string }
): Promise<SafeRemoteImageResult> {
  let current: URL
  try {
    current = parseAllowedHttpImageUrl(rawUrl)
  } catch (err) {
    const code = err instanceof Error ? err.message : 'INVALID_URL'
    return { ok: false, code, message: mapUrlValidationError(code) }
  }

  try {
    await assertResolvablePublicHost(current.hostname)
  } catch (err) {
    const code = err instanceof Error ? err.message : 'BLOCKED_HOST'
    return { ok: false, code, message: mapUrlValidationError(code) }
  }

  const referer = options?.referer ?? current.origin

  for (let hop = 0; hop <= REMOTE_IMAGE_MAX_REDIRECTS; hop++) {
    const fetched = await fetchImageAtUrl(current, referer)
    if (fetched.ok) return fetched
    if (fetched.code !== 'REDIRECT') return fetched

    if (hop === REMOTE_IMAGE_MAX_REDIRECTS) {
      return {
        ok: false,
        code: 'TOO_MANY_REDIRECTS',
        message: 'Çok fazla yönlendirme.'
      }
    }

    try {
      const nextRaw = new URL(fetched.message, current.toString()).toString()
      current = parseAllowedHttpImageUrl(nextRaw)
      await assertResolvablePublicHost(current.hostname)
    } catch (err) {
      const code = err instanceof Error ? err.message : 'INVALID_URL'
      return { ok: false, code, message: mapUrlValidationError(code) }
    }
  }

  return { ok: false, code: 'FETCH_FAILED', message: 'Görsel indirilemedi.' }
}

function mapUrlValidationError(code: string): string {
  switch (code) {
    case 'INVALID_URL':
      return 'Geçersiz görsel URL’si.'
    case 'INVALID_PROTOCOL':
      return 'Yalnızca http ve https adresleri desteklenir.'
    case 'CREDENTIALS_NOT_ALLOWED':
      return 'URL kullanıcı adı veya şifre içeremez.'
    case 'INVALID_PORT':
      return 'Yalnızca standart HTTP/HTTPS portları desteklenir.'
    case 'PRIVATE_IP':
    case 'BLOCKED_HOST':
      return 'Bu adres güvenlik nedeniyle kullanılamaz.'
    case 'DNS_FAILED':
      return 'Alan adı çözümlenemedi.'
    default:
      return 'Geçersiz görsel URL’si.'
  }
}

export function extensionForRemoteContentType(contentType: string): string {
  switch (contentType) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    case 'image/svg+xml':
      return 'svg'
    default:
      return 'png'
  }
}
