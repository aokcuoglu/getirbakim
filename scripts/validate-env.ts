import { config as loadEnv } from 'dotenv'

type Target = 'local' | 'staging' | 'production'

const targetArg = process.argv[2]

if (targetArg !== 'local' && targetArg !== 'staging' && targetArg !== 'production') {
  console.error('Usage: bun scripts/validate-env.ts <local|staging|production>')
  process.exit(1)
}

const target = targetArg as Target

if (target === 'local') {
  loadEnv({ path: '.env.local' })
  loadEnv()
}

const PUBLIC_REQUIRED = [
  'NEXT_PUBLIC_SITE_URL',
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY'
] as const

const SERVER_REQUIRED = [
  'DATABASE_URL',
  'DIRECT_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'TAMI_MERCHANT_NUMBER',
  'TAMI_TERMINAL_NUMBER',
  'TAMI_SECRET_KEY',
  'TAMI_JWK_KID',
  'TAMI_JWK_K',
  'TAMI_PAYMENT_API_BASE_URL',
  'TAMI_PORTAL_BASE_URL'
] as const

const DINAMIK_REQUIRED = ['DINAMIK_BASE', 'DINAMIK_APIKEY', 'DINAMIK_SECRETKEY'] as const

const SECRET_NAME_PATTERNS = [
  'DATABASE_URL',
  'DIRECT_URL',
  'SECRET',
  'SERVICE_ROLE',
  'MASTER_KEY',
  'CRON_SECRET',
  'TAMI_'
]

const errors: string[] = []
const warnings: string[] = []

function getEnv(name: string): string {
  return process.env[name]?.trim() || ''
}

function requireVar(name: string) {
  if (!getEnv(name)) {
    errors.push(`Missing required env: ${name}`)
  }
}

function requireAll(names: readonly string[]) {
  for (const name of names) requireVar(name)
}

function isAbsoluteHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function isAbsoluteUrl(value: string): boolean {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

function validateUrl(name: string, mode: 'absolute' | 'https') {
  const value = getEnv(name)
  if (!value) return

  const valid = mode === 'https' ? isAbsoluteHttpsUrl(value) : isAbsoluteUrl(value)
  if (!valid) {
    errors.push(`${name} must be a valid ${mode === 'https' ? 'HTTPS ' : ''}URL.`)
  }
}

function validateStartsWith(name: string, prefix: string) {
  const value = getEnv(name)
  if (value && !value.startsWith(prefix)) {
    errors.push(`${name} must start with ${prefix}`)
  }
}

function validateExact(name: string, expected: string) {
  const value = getEnv(name)
  if (value && value !== expected) {
    errors.push(`${name} must be ${expected} for ${target}.`)
  }
}

if (target === 'local') {
  requireAll(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'])
  requireAll(SERVER_REQUIRED)

  if (!getEnv('NEXT_PUBLIC_SITE_URL')) {
    warnings.push('NEXT_PUBLIC_SITE_URL is missing. Local runtime will fall back to localhost where supported.')
  }

  if (!getEnv('NEXT_PUBLIC_APP_URL')) {
    warnings.push('NEXT_PUBLIC_APP_URL is missing. Routes that build absolute URLs may fall back to localhost.')
  }

  if (!getEnv('CRON_SECRET')) {
    warnings.push('CRON_SECRET is missing. Internal cron routes cannot be safely tested locally until it is set.')
  }
} else {
  requireAll(PUBLIC_REQUIRED)
  requireAll([...SERVER_REQUIRED, 'CRON_SECRET'])
}

if (target !== 'local') {
  requireAll(DINAMIK_REQUIRED)
  if (getEnv('DINAMIK_PROXY_REQUIRED') !== 'false') {
    requireVar('DINAMIK_PROXY_URL')
  }
}

if (getEnv('MEILI_ENABLED') === 'true') {
  requireAll(['MEILI_HOST', 'MEILI_MASTER_KEY'])
  if (target !== 'local') {
    requireAll(['NEXT_PUBLIC_MEILI_HOST', 'NEXT_PUBLIC_MEILI_SEARCH_KEY'])
  } else {
    if (!getEnv('NEXT_PUBLIC_MEILI_HOST')) {
      warnings.push('NEXT_PUBLIC_MEILI_HOST is not set. Client-side search will not work. Server-side search via /api/search will still work.')
    }
  }
}

validateUrl('NEXT_PUBLIC_SITE_URL', target === 'local' ? 'absolute' : 'https')
validateUrl('NEXT_PUBLIC_APP_URL', target === 'local' ? 'absolute' : 'https')
validateUrl('NEXT_PUBLIC_SUPABASE_URL', 'https')
validateStartsWith('DATABASE_URL', 'postgresql://')
validateStartsWith('DIRECT_URL', 'postgresql://')

if (target === 'production' && getEnv('NEXT_PUBLIC_ALLOW_INDEXING') !== 'true') {
  warnings.push('NEXT_PUBLIC_ALLOW_INDEXING is not "true" — search engines will be blocked from indexing in production.')
}

if (target === 'staging') {
  validateExact('TAMI_PAYMENT_API_BASE_URL', 'https://sandbox-paymentapi.tami.com.tr')
  validateExact('TAMI_PORTAL_BASE_URL', 'https://sandbox-portal.tami.com.tr')
}

if (target === 'production') {
  validateExact('TAMI_PAYMENT_API_BASE_URL', 'https://paymentapi.tami.com.tr')
  validateExact('TAMI_PORTAL_BASE_URL', 'https://portal.tami.com.tr')
}

if (target === 'local' && getEnv('TAMI_PAYMENT_API_BASE_URL') === 'https://paymentapi.tami.com.tr') {
  warnings.push(
    'Local env is pointing to Tami production API. Prefer sandbox locally unless you intentionally need live testing.'
  )
}

if (
  getEnv('NEXT_PUBLIC_SITE_URL') &&
  getEnv('NEXT_PUBLIC_APP_URL') &&
  getEnv('NEXT_PUBLIC_SITE_URL') !== getEnv('NEXT_PUBLIC_APP_URL')
) {
  warnings.push('NEXT_PUBLIC_SITE_URL and NEXT_PUBLIC_APP_URL differ. Confirm this is intentional.')
}

for (const [name, value] of Object.entries(process.env)) {
  if (!name.startsWith('NEXT_PUBLIC_')) continue
  if (!value?.trim()) continue

  const leaked = SECRET_NAME_PATTERNS.some((pattern) => name.includes(pattern))
  if (leaked) {
    errors.push(`Potential secret exposed via public env name: ${name}`)
  }
}

if (errors.length > 0) {
  console.error(`Environment validation failed for ${target}.`)
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  if (warnings.length > 0) {
    console.error('Warnings:')
    for (const warning of warnings) {
      console.error(`- ${warning}`)
    }
  }
  process.exit(1)
}

console.log(`Environment validation passed for ${target}.`)

if (warnings.length > 0) {
  console.log('Warnings:')
  for (const warning of warnings) {
    console.log(`- ${warning}`)
  }
}
