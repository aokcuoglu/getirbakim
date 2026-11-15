import "server-only";
// Hosted-payment transport adapted from the user-owned gb/lib/payments/tami.ts.
import crypto from 'node:crypto'

const DEFAULT_PAYMENT_API_BASE_URL = 'https://sandbox-paymentapi.tami.com.tr'
const DEFAULT_PORTAL_BASE_URL = 'https://sandbox-portal.tami.com.tr'

type TamiLocale = 'tr' | 'en'

export class TamiRequestError extends Error {
  status: number
  payload: Record<string, unknown>

  constructor(message: string, status: number, payload: Record<string, unknown>) {
    super(message)
    this.name = 'TamiRequestError'
    this.status = status
    this.payload = payload
  }
}

function normalizeBaseUrl(value: string | undefined, fallback: string): string {
  return (value?.trim() || fallback).replace(/\/$/, '')
}

function getTamiConfig() {
  const merchantNumber = process.env.TAMI_MERCHANT_NUMBER?.trim()
  const terminalNumber = process.env.TAMI_TERMINAL_NUMBER?.trim()
  const secretKey = process.env.TAMI_SECRET_KEY?.trim()
  const jwkKid = process.env.TAMI_JWK_KID?.trim()
  const jwkKey = process.env.TAMI_JWK_K?.trim()

  if (!merchantNumber || !terminalNumber || !secretKey || !jwkKid || !jwkKey) {
    throw new Error(
      'TAMI_MERCHANT_NUMBER, TAMI_TERMINAL_NUMBER, TAMI_SECRET_KEY, TAMI_JWK_KID or TAMI_JWK_K is missing.'
    )
  }

  const api = normalizeBaseUrl(process.env.TAMI_PAYMENT_API_BASE_URL, DEFAULT_PAYMENT_API_BASE_URL)
  const portal = normalizeBaseUrl(process.env.TAMI_PORTAL_BASE_URL, DEFAULT_PORTAL_BASE_URL)
  const sandbox = api === DEFAULT_PAYMENT_API_BASE_URL && portal === DEFAULT_PORTAL_BASE_URL
  const production = api === 'https://paymentapi.tami.com.tr' && portal === 'https://portal.tami.com.tr'
  if (!sandbox && !production) throw new Error('TAMI endpoint pair is invalid.')
  return {
    merchantNumber,
    terminalNumber,
    secretKey,
    jwkKid,
    jwkKey,
    paymentApiBaseUrl: normalizeBaseUrl(
      process.env.TAMI_PAYMENT_API_BASE_URL,
      DEFAULT_PAYMENT_API_BASE_URL
    ),
    portalBaseUrl: normalizeBaseUrl(process.env.TAMI_PORTAL_BASE_URL, DEFAULT_PORTAL_BASE_URL)
  }
}

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function fromBase64Url(value: string): Buffer {
  let normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  while (normalized.length % 4 !== 0) {
    normalized += '='
  }
  return Buffer.from(normalized, 'base64')
}

function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const clone = { ...payload }
  delete clone.securityHash
  return clone
}

export function buildPgAuthToken(): string {
  const { merchantNumber, terminalNumber, secretKey } = getTamiConfig()
  const hash = crypto
    .createHash('sha256')
    .update(`${merchantNumber}${terminalNumber}${secretKey}`, 'utf8')
    .digest('base64')

  return `${merchantNumber}:${terminalNumber}:${hash}`
}

export function buildCorrelationId(prefix = 'tami'): string {
  return `${prefix}-${crypto.randomUUID()}`
}

export function buildSecurityHash(payload: Record<string, unknown>): string {
  const { jwkKid, jwkKey } = getTamiConfig()
  const header = toBase64Url(
    Buffer.from(JSON.stringify({ alg: 'HS512', typ: 'JWT', kid: jwkKid }), 'utf8')
  )
  const body = toBase64Url(Buffer.from(JSON.stringify(sanitizePayload(payload)), 'utf8'))
  const signingInput = `${header}.${body}`
  const signature = crypto
    .createHmac('sha512', fromBase64Url(jwkKey))
    .update(signingInput, 'utf8')
    .digest()

  return `${signingInput}.${toBase64Url(signature)}`
}

export function verifySecurityHash(payload: Record<string, unknown>, securityHash: string): boolean {
  const segments = securityHash.split('.')
  if (segments.length !== 3 || segments.some(segment => !/^[A-Za-z0-9_-]+$/.test(segment))) return false
  const [header, body, signature] = segments
  try {
    const decoded = JSON.parse(fromBase64Url(header).toString('utf8'))
    if (decoded.alg !== 'HS512') return false
  } catch { return false }

  const { jwkKey } = getTamiConfig()
  const signingInput = `${header}.${body}`
  const expected = crypto
    .createHmac('sha512', fromBase64Url(jwkKey))
    .update(signingInput, 'utf8')
    .digest()

  const received = fromBase64Url(signature)
  if (received.length !== expected.length) return false

  const expectedBody = JSON.stringify(sanitizePayload(payload))
  const receivedBody = fromBase64Url(body).toString('utf8')

  return crypto.timingSafeEqual(received, expected) && receivedBody === expectedBody
}

function buildHeaders(locale: TamiLocale, correlationId?: string, apiVersion: 'v3' | 'v4' = 'v3'): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'Accept-Language': locale,
    'PG-Api-Version': apiVersion,
    'PG-Auth-Token': buildPgAuthToken(),
    correlationId: correlationId || buildCorrelationId()
  }
}

async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  if (!text) return {}

  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`Tami response is not valid JSON. HTTP ${response.status}.`)
  }
}

async function postTamiJson(
  path: string,
  payload: Record<string, unknown>,
  locale: TamiLocale,
  correlationId?: string,
  options?: {
    includeSecurityHash?: boolean
    timeoutMs?: number
  }
): Promise<Record<string, unknown>> {
  const { paymentApiBaseUrl } = getTamiConfig()
  const includeSecurityHash = options?.includeSecurityHash ?? true
  const body = includeSecurityHash ? { ...payload, securityHash: buildSecurityHash(payload) } : payload

  const response = await fetch(`${paymentApiBaseUrl}${path}`, {
    method: 'POST',
    headers: buildHeaders(locale, correlationId),
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(options?.timeoutMs ?? 15000)
  })

  const json = await parseJsonResponse(response)
  if (!response.ok) {
    const rawMessage =
      typeof json.message === 'string'
        ? json.message
        : typeof json.errorMessage === 'string'
          ? json.errorMessage
          : `Tami request failed with HTTP ${response.status}.`
    const errorCode =
      typeof json.errorCode === 'number'
        ? String(json.errorCode)
        : typeof json.errorCode === 'string'
          ? json.errorCode
          : null
    const message = errorCode ? `${rawMessage} (TAMI errorCode: ${errorCode})` : rawMessage
    throw new TamiRequestError(message, response.status, json)
  }

  return json
}

export function buildHostedPaymentUrl(oneTimeToken: string): string {
  const { portalBaseUrl } = getTamiConfig()
  const url = new URL('/hostedPaymentPage', portalBaseUrl)
  url.searchParams.set('token', oneTimeToken)
  return url.toString()
}

export async function createHostedToken(input: {
  amount: number
  orderId: string
  successCallbackUrl: string
  failCallbackUrl: string
  mobilePhoneNumber: string
  data: Record<string, unknown>
  locale: TamiLocale
}): Promise<{
  oneTimeToken: string
  tokenCreateTime: string | null
  raw: Record<string, unknown>
}> {
  const payload = {
    amount: Number(input.amount.toFixed(2)),
    orderId: input.orderId,
    successCallbackUrl: input.successCallbackUrl,
    failCallbackUrl: input.failCallbackUrl,
    mobilePhoneNumber: input.mobilePhoneNumber,
    data: input.data
  }

  const raw = await postTamiJson(
    '/hosted/create-one-time-hosted-token',
    payload,
    input.locale,
    undefined,
    { includeSecurityHash: false }
  )

  const oneTimeToken =
    typeof raw.oneTimeToken === 'string'
      ? raw.oneTimeToken
      : typeof raw.token === 'string'
        ? raw.token
        : null

  if (!oneTimeToken) {
    throw new Error('Tami hosted token response did not include oneTimeToken.')
  }

  return {
    oneTimeToken,
    tokenCreateTime: typeof raw.tokenCreateTime === 'string' ? raw.tokenCreateTime : null,
    raw
  }
}

export type TamiQueryResponse = {
  currency: string | null
  success: boolean
  orderId: string | null
  orderStatus: string | null
  paymentStatus: string | null
  amount: number
  installmentCount: number | null
  securityHashValid: boolean
  bankReferenceNumber: string | null
  bankAuthCode: string | null
  transactionStatus: string | null
  transactions: Array<Record<string, unknown>>
  raw: Record<string, unknown>
}

export async function queryPaymentByOrderId(input: {
  orderId: string
  locale: TamiLocale
  isTransactionDetail?: boolean
  /** Interactive callers (order page, polling) pass a short budget; the default stays 15 s. */
  timeoutMs?: number
}): Promise<TamiQueryResponse> {
  const payload = {
    orderId: input.orderId,
    isTransactionDetail: input.isTransactionDetail ?? true
  }

  const raw = await postTamiJson('/payment/query', payload, input.locale, undefined, { timeoutMs: input.timeoutMs })
  const securityHash = typeof raw.securityHash === 'string' ? raw.securityHash : ''
  const securityHashValid = securityHash ? verifySecurityHash(raw, securityHash) : false
  const transactions = Array.isArray(raw.transactions)
    ? (raw.transactions as Array<Record<string, unknown>>)
    : []

  const authTransaction = transactions.find((transaction) => {
    const type = String(transaction.transactionType || '').toUpperCase()
    const status = String(transaction.transactionStatus || '').toUpperCase()
    return type === 'AUTH' && status === 'SUCCESS'
  })

  return {
    currency: typeof raw.currency === 'string' ? raw.currency : null,
    success: raw.success === true,
    orderId: typeof raw.orderId === 'string' ? raw.orderId : null,
    orderStatus: typeof raw.orderStatus === 'string' ? raw.orderStatus : null,
    paymentStatus: typeof raw.paymentStatus === 'string' ? raw.paymentStatus : null,
    amount: typeof raw.amount === 'number' ? raw.amount : Number(raw.amount || 0),
    installmentCount:
      typeof raw.installmentCount === 'number'
        ? raw.installmentCount
        : raw.installmentCount != null
          ? Number(raw.installmentCount)
          : null,
    securityHashValid,
    bankReferenceNumber:
      typeof authTransaction?.bankReferenceNumber === 'string'
        ? authTransaction.bankReferenceNumber
        : null,
    bankAuthCode:
      typeof authTransaction?.bankAuthCode === 'string' ? authTransaction.bankAuthCode : null,
    transactionStatus:
      typeof authTransaction?.transactionStatus === 'string'
        ? authTransaction.transactionStatus
        : null,
    transactions,
    raw
  }
}

// A callback URL or success=true alone is never evidence of settled payment.
export function verifiedPaymentSuccess(query: TamiQueryResponse, orderId: string, expectedKurus: number): boolean {
  const amountKurus = query.amount * 100;
  return Number.isSafeInteger(expectedKurus) && expectedKurus > 0 &&
    Number.isFinite(amountKurus) && Math.abs(amountKurus - Math.round(amountKurus)) < 0.000001 &&
    Math.round(amountKurus) === expectedKurus && query.orderId === orderId && query.currency === 'TRY' &&
    query.securityHashValid && query.success && query.orderStatus === 'AUTH' && query.transactionStatus === 'SUCCESS';
}

/** Throws when the TAMI credentials are missing, before anything is recorded or sent. */
export function assertTamiConfigured(): void {
  getTamiConfig()
}

function tamiAudience(): string {
  const { merchantNumber, terminalNumber } = getTamiConfig()
  return `${merchantNumber}:${terminalNumber}`
}

/**
 * API v4 request body (TAMI Node sample, tamiToken.js): an HS512 JWS over the request claims, encrypted as a compact
 * JWE with alg "dir" / enc "A256GCM". The signing key is the decoded JWK `k`; the encryption key is its SHA-256.
 */
export function buildSignedRequest(body: Record<string, unknown>): string {
  const { jwkKid, jwkKey } = getTamiConfig()
  const signingKey = fromBase64Url(jwkKey)
  const encryptionKey = crypto.createHash('sha256').update(signingKey).digest()
  const now = Math.floor(Date.now() / 1000)
  const claims = {
    iss: tamiAudience(),
    aud: 'tami',
    jti: crypto.randomUUID(),
    iat: now,
    nbf: now,
    exp: now + 600,
    'tami:body': body,
    'tami:apiVersion': 'v4'
  }
  const header = toBase64Url(Buffer.from(JSON.stringify({ alg: 'HS512', kid: jwkKid, typ: 'JWT' }), 'utf8'))
  const payload = toBase64Url(Buffer.from(JSON.stringify(claims), 'utf8'))
  const signature = crypto.createHmac('sha512', signingKey).update(`${header}.${payload}`, 'utf8').digest()
  const jws = `${header}.${payload}.${toBase64Url(signature)}`

  const jweHeader = toBase64Url(Buffer.from(JSON.stringify({ alg: 'dir', enc: 'A256GCM', cty: 'JWT' }), 'utf8'))
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv)
  cipher.setAAD(Buffer.from(jweHeader, 'ascii'))
  const cipherText = Buffer.concat([cipher.update(jws, 'utf8'), cipher.final()])
  return `${jweHeader}..${toBase64Url(iv)}.${toBase64Url(cipherText)}.${toBase64Url(cipher.getAuthTag())}`
}

/**
 * API v4 `signedResponse`: a plain HS512 JWS. Signature, audience ("merchant:terminal") and expiry (60 s leeway) are
 * checked; returns the `tami:body` claim. Throws on anything else.
 */
export function decodeSignedResponse(token: string): Record<string, unknown> {
  const segments = token.split('.')
  if (segments.length !== 3 || segments.some(segment => !/^[A-Za-z0-9_-]+$/.test(segment))) {
    throw new Error('signedResponse is not a compact JWS.')
  }
  const [header, payload, signature] = segments
  const { jwkKey } = getTamiConfig()
  let alg: unknown
  try { alg = JSON.parse(fromBase64Url(header).toString('utf8')).alg } catch { alg = null }
  const expected = crypto.createHmac('sha512', fromBase64Url(jwkKey)).update(`${header}.${payload}`, 'utf8').digest()
  const received = fromBase64Url(signature)
  if (alg !== 'HS512' || received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    throw new Error('signedResponse signature is invalid.')
  }
  const claims = JSON.parse(fromBase64Url(payload).toString('utf8')) as Record<string, unknown>
  if (claims.aud !== tamiAudience()) throw new Error('signedResponse audience is wrong.')
  if (typeof claims.exp !== 'number' || claims.exp + 60 < Math.floor(Date.now() / 1000)) {
    throw new Error('signedResponse has expired.')
  }
  const body = claims['tami:body']
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('signedResponse has no body.')
  return body as Record<string, unknown>
}

/**
 * Outcome of a void/refund call. `rejected` is a definite "nothing happened" from TAMI (safe to retry); `unknown`
 * means the reversal may or may not have happened and must be checked before anything else is sent.
 */
export type TamiReversalResult =
  | { kind: 'ok'; body: Record<string, unknown>; raw: string }
  | { kind: 'rejected'; errorCode: string; errorMessage: string; errorGroup: string | null; httpStatus: number; body: Record<string, unknown> }
  | { kind: 'unknown'; reason: string; httpStatus: number | null }

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : null
}

// The documented paths carry /api/v0; the hosted/query calls above work without it. The unprefixed path is only tried
// after a 404, which means the first one reached no endpoint. docs/payments.md records which one TAMI answers.
const SIGNED_PATH_PREFIXES = ['/api/v0', '']

async function postTamiSigned(path: string, body: Record<string, unknown>, correlationId: string): Promise<TamiReversalResult> {
  const { paymentApiBaseUrl } = getTamiConfig()
  const headers = buildHeaders('tr', correlationId, 'v4')
  for (const [index, prefix] of SIGNED_PATH_PREFIXES.entries()) {
    let response: Response
    let raw: string
    try {
      response = await fetch(`${paymentApiBaseUrl}${prefix}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ signedRequest: buildSignedRequest(body) }),
        cache: 'no-store',
        signal: AbortSignal.timeout(15000)
      })
      raw = await response.text()
    } catch {
      return { kind: 'unknown', reason: 'TAMI yanıt vermedi (ağ hatası veya zaman aşımı).', httpStatus: null }
    }
    let json: Record<string, unknown> | null = null
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : null
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) json = parsed as Record<string, unknown>
    } catch { json = null }
    if (response.status === 404 && json?.errorCode == null && index < SIGNED_PATH_PREFIXES.length - 1) continue
    if (!json) return { kind: 'unknown', reason: `TAMI yanıtı JSON değil. HTTP ${response.status}.`, httpStatus: response.status }
    if (typeof json.signedResponse === 'string') {
      let decoded: Record<string, unknown>
      try { decoded = decodeSignedResponse(json.signedResponse) } catch (error) {
        return { kind: 'unknown', reason: `TAMI yanıtı doğrulanamadı: ${error instanceof Error ? error.message : 'imza hatası'}`, httpStatus: response.status }
      }
      if (decoded.success === true) return { kind: 'ok', body: decoded, raw: json.signedResponse }
      if (decoded.success === false) {
        return {
          kind: 'rejected', errorCode: text(decoded.errorCode) ?? 'unknown', errorMessage: text(decoded.errorMessage) ?? 'TAMI işlemi reddetti.',
          errorGroup: text(decoded.errorGroup), httpStatus: response.status, body: decoded
        }
      }
      return { kind: 'unknown', reason: 'TAMI imzalı yanıtında success alanı yok.', httpStatus: response.status }
    }
    const errorCode = text(json.errorCode)
    // Timeouts, conflicts and throttling may hide a call TAMI is still processing; they are never a definite "no".
    const inconclusive = [408, 409, 425, 429].includes(response.status)
    if (response.status >= 400 && response.status < 500 && !inconclusive && json.success === false && errorCode) {
      return {
        kind: 'rejected', errorCode, errorMessage: text(json.errorMessage) ?? text(json.message) ?? 'TAMI işlemi reddetti.',
        errorGroup: text(json.errorGroup), httpStatus: response.status, body: json
      }
    }
    return { kind: 'unknown', reason: `TAMI yanıtı imzasız veya beklenmedik. HTTP ${response.status}.`, httpStatus: response.status }
  }
  return { kind: 'unknown', reason: 'TAMI iptal/iade adresi bulunamadı (HTTP 404).', httpStatus: 404 }
}

/** Same-day cancellation, before end-of-day settlement. Never throws on provider errors. */
export function voidTamiPayment(input: { orderId: string; reason: string; correlationId: string }): Promise<TamiReversalResult> {
  return postTamiSigned('/payment/void', { orderId: input.orderId, reason: input.reason.slice(0, 150) }, input.correlationId)
}

/** Refund of a settled payment; the full amount is always sent explicitly. Never throws on provider errors. */
export function refundTamiPayment(input: { orderId: string; amountKurus: number; reason: string; correlationId: string }): Promise<TamiReversalResult> {
  return postTamiSigned('/payment/refund', {
    orderId: input.orderId, amount: (input.amountKurus / 100).toFixed(2), reason: input.reason.slice(0, 150)
  }, input.correlationId)
}

function kurus(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  const scaled = amount * 100
  return Number.isFinite(scaled) && Math.abs(scaled - Math.round(scaled)) < 0.000001 ? Math.round(scaled) : null
}

/**
 * A signed success alone is not enough: the reply must name this call (correlationId) and reverse exactly the paid
 * amount. Refund replies must carry the amount; void replies are checked when they do.
 */
export function verifiedReversal(body: Record<string, unknown>, expected: { kind: 'void' | 'refund'; amountKurus: number; correlationId: string }): boolean {
  if (body.success !== true) return false
  if (body.correlationId !== expected.correlationId) return false
  if (body.currency != null && body.currency !== 'TRY') return false
  if (body.amount == null) return expected.kind === 'void'
  return kurus(body.amount) === expected.amountKurus
}
