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

export type TamiDirectAuthPayload = {
  amount: number
  orderId: string
  currency: 'TRY'
  installmentCount: number
  paymentGroup: 'PRODUCT'
  paymentChannel: 'WEB'
  motoInd?: boolean
  card: {
    holderName: string
    cvv: string
    expireMonth: number
    expireYear: number
    number: string
  }
  billingAddress: {
    address: string
    city: string
    country: string
    contactName: string
    phoneNumber: string
    zipCode: string
    emailAddress?: string
    companyName?: string
    district?: string
  }
  shippingAddress: {
    address: string
    city: string
    country: string
    contactName: string
    phoneNumber: string
    zipCode: string
    emailAddress?: string
    companyName?: string
    district?: string
  }
  buyer: {
    ipAddress: string
    buyerId: string
    name: string
    surName: string
    city: string
    country: string
    emailAddress: string
    phoneNumber: string
    registrationAddress: string
    registrationDate: string
    lastLoginDate: string
    zipCode?: string
    identityNumber?: string
  }
  basket: {
    basketId: string
    basketItems: Array<{
      itemId: string
      name: string
      itemType: 'PHYSICAL' | 'VIRTUAL'
      numberOfProducts: number
      totalPrice: number
      unitPrice: number
      category?: string
      subCategory?: string
    }>
  }
}

export type TamiDirectAuthResponse = {
  success: boolean
  orderId: string | null
  amount: number
  currency: string | null
  installmentCount: number | null
  paymentStatus: string | null
  transactionStatus: string | null
  bankReferenceNumber: string | null
  bankAuthCode: string | null
  securityHashValid: boolean
  errorCode: string | null
  errorMessage: string | null
  raw: Record<string, unknown>
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
  const [header, body, signature] = securityHash.split('.')
  if (!header || !body || !signature) return false

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

function buildHeaders(locale: TamiLocale, correlationId?: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'Accept-Language': locale,
    'PG-Api-Version': 'v3',
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
  }
): Promise<Record<string, unknown>> {
  const { paymentApiBaseUrl } = getTamiConfig()
  const includeSecurityHash = options?.includeSecurityHash ?? true
  const body = includeSecurityHash ? { ...payload, securityHash: buildSecurityHash(payload) } : payload

  const response = await fetch(`${paymentApiBaseUrl}${path}`, {
    method: 'POST',
    headers: buildHeaders(locale, correlationId),
    body: JSON.stringify(body),
    cache: 'no-store'
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

export async function authorizeDirectPayment(input: {
  payload: TamiDirectAuthPayload
  locale: TamiLocale
  correlationId?: string
}): Promise<TamiDirectAuthResponse> {
  const raw = await postTamiJson('/payment/auth', input.payload, input.locale, input.correlationId)
  const securityHash = typeof raw.securityHash === 'string' ? raw.securityHash : ''
  const securityHashValid = securityHash ? verifySecurityHash(raw, securityHash) : false

  return {
    success: raw.success === true,
    orderId: typeof raw.orderId === 'string' ? raw.orderId : null,
    amount: typeof raw.amount === 'number' ? raw.amount : Number(raw.amount || 0),
    currency: typeof raw.currency === 'string' ? raw.currency : null,
    installmentCount:
      typeof raw.installmentCount === 'number'
        ? raw.installmentCount
        : raw.installmentCount != null
          ? Number(raw.installmentCount)
          : null,
    paymentStatus: typeof raw.paymentStatus === 'string' ? raw.paymentStatus : null,
    transactionStatus:
      typeof raw.transactionStatus === 'string' ? raw.transactionStatus : null,
    bankReferenceNumber:
      typeof raw.bankReferenceNumber === 'string' ? raw.bankReferenceNumber : null,
    bankAuthCode: typeof raw.bankAuthCode === 'string' ? raw.bankAuthCode : null,
    securityHashValid,
    errorCode:
      typeof raw.errorCode === 'number'
        ? String(raw.errorCode)
        : typeof raw.errorCode === 'string'
          ? raw.errorCode
          : null,
    errorMessage:
      typeof raw.errorMessage === 'string'
        ? raw.errorMessage
        : typeof raw.message === 'string'
          ? raw.message
          : null,
    raw
  }
}

export type TamiQueryResponse = {
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
  raw: Record<string, unknown>
}

export async function queryPaymentByOrderId(input: {
  orderId: string
  locale: TamiLocale
  isTransactionDetail?: boolean
}): Promise<TamiQueryResponse> {
  const payload = {
    orderId: input.orderId,
    isTransactionDetail: input.isTransactionDetail ?? true
  }

  const raw = await postTamiJson('/payment/query', payload, input.locale)
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
    raw
  }
}
