import 'server-only'

const DEFAULT_TIMEOUT_MS = 30_000
const TOKEN_BUFFER_MS = 5 * 60 * 1000

interface BasbugLoginResponse {
  token: string
  refreshToken: string
  tokenBitisSuresi: number
  refreshTokenBitisSuresi: number
  tokenTipi: string
}

interface BasbugTokenCache {
  token: string
  refreshToken: string
  tokenExpiresAt: number
  refreshTokenExpiresAt: number
  tokenTipi: string
}

let tokenCache: BasbugTokenCache | null = null

function validateEnv() {
  const missing: string[] = []
  if (!process.env.BASBUG_BASE_URL) missing.push('BASBUG_BASE_URL')
  if (!process.env.BASBUG_USERNAME) missing.push('BASBUG_USERNAME')
  if (!process.env.BASBUG_PASSWORD) missing.push('BASBUG_PASSWORD')
  if (!process.env.BASBUG_CLIENT_ID) missing.push('BASBUG_CLIENT_ID')
  if (!process.env.BASBUG_CLIENT_SECRET) missing.push('BASBUG_CLIENT_SECRET')
  if (missing.length > 0) {
    throw new Error(`Başbuğ API env eksik: ${missing.join(', ')}`)
  }
}

async function basbugLogin(): Promise<BasbugTokenCache> {
  validateEnv()

  const url = `${process.env.BASBUG_BASE_URL}/auth/Login`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      kullaniciAdi: process.env.BASBUG_USERNAME,
      parola: process.env.BASBUG_PASSWORD,
      clientSecret: process.env.BASBUG_CLIENT_SECRET,
      clientId: process.env.BASBUG_CLIENT_ID
    }),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    cache: 'no-store'
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(
      `Başbuğ login başarısız (${response.status}): ${body.slice(0, 300)}`
    )
  }

  const data: BasbugLoginResponse = await response.json()

  if (!data.token) {
    throw new Error('Başbuğ login: token alınamadı.')
  }

  const now = Date.now()

  const cache: BasbugTokenCache = {
    token: data.token,
    refreshToken: data.refreshToken,
    tokenExpiresAt: now + data.tokenBitisSuresi,
    refreshTokenExpiresAt: now + data.refreshTokenBitisSuresi,
    tokenTipi: data.tokenTipi || 'Bearer'
  }

  tokenCache = cache
  return cache
}

async function basbugRefreshToken(
  currentCache: BasbugTokenCache
): Promise<BasbugTokenCache> {
  validateEnv()

  const url = `${process.env.BASBUG_BASE_URL}/auth/Login`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      kullaniciAdi: process.env.BASBUG_USERNAME,
      parola: process.env.BASBUG_PASSWORD,
      clientSecret: process.env.BASBUG_CLIENT_SECRET,
      clientId: process.env.BASBUG_CLIENT_ID
    }),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    cache: 'no-store'
  })

  if (!response.ok) {
    tokenCache = null
    throw new Error(
      `Başbuğ token refresh başarısız (${response.status})`
    )
  }

  const data: BasbugLoginResponse = await response.json()

  if (!data.token) {
    tokenCache = null
    throw new Error('Başbuğ token refresh: token alınamadı.')
  }

  const now = Date.now()

  const cache: BasbugTokenCache = {
    token: data.token,
    refreshToken: data.refreshToken,
    tokenExpiresAt: now + data.tokenBitisSuresi,
    refreshTokenExpiresAt: now + data.refreshTokenBitisSuresi,
    tokenTipi: data.tokenTipi || 'Bearer'
  }

  tokenCache = cache
  return cache
}

export async function getBasbugToken(): Promise<string> {
  const now = Date.now()

  if (tokenCache && now < tokenCache.tokenExpiresAt - TOKEN_BUFFER_MS) {
    return tokenCache.token
  }

  const expired =
    !tokenCache ||
    (tokenCache && now >= tokenCache.tokenExpiresAt - TOKEN_BUFFER_MS)

  if (
    expired &&
    tokenCache &&
    now < tokenCache.refreshTokenExpiresAt - TOKEN_BUFFER_MS
  ) {
    try {
      const refreshed = await basbugRefreshToken(tokenCache)
      return refreshed.token
    } catch {
      return (await basbugLogin()).token
    }
  }

  return (await basbugLogin()).token
}

function clearTokenCache() {
  tokenCache = null
}

export async function basbugFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
  retryOn401 = true
): Promise<T> {
  validateEnv()

  const baseUrl = process.env.BASBUG_BASE_URL!
  const timeoutMs = parseInt(
    process.env.BASBUG_ITEM_TIMEOUT_MS || '',
    10
  ) || DEFAULT_TIMEOUT_MS

  const url = `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`

  const token = await getBasbugToken()

  const headers = new Headers(init.headers as HeadersInit)
  headers.set('Authorization', `Bearer ${token}`)
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')

  const requestInit: RequestInit = {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    cache: 'no-store'
  }

  let response: Response
  try {
    response = await fetch(url, requestInit)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Başbuğ isteği başarısız (${url}): ${message}`)
  }

  if (response.status === 401 && retryOn401) {
    clearTokenCache()
    return basbugFetch<T>(path, init, false)
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(
      `Başbuğ API hatası (${response.status}) ${url}: ${body.slice(0, 300)}`
    )
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return response.json() as Promise<T>
  }

  return (await response.text()) as unknown as T
}
