import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const DEFAULT_DATABASE_POOL_MAX = process.env.NODE_ENV === 'production' ? 8 : 3

function parsePoolMax(value: string | undefined): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_DATABASE_POOL_MAX
  return Math.min(parsed, 12)
}

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Add it to your .env file (see .env.example for other vars).'
    )
  }

  const poolMax = parsePoolMax(process.env.DATABASE_POOL_MAX ?? process.env.PG_POOL_MAX)

  const parsedConnectionTimeout = Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS)
  const connectionTimeoutMillis =
    Number.isFinite(parsedConnectionTimeout) && parsedConnectionTimeout >= 1000
      ? Math.min(parsedConnectionTimeout, 30000)
      : 8000

  const log = process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error']

  const isAccelerateUrl =
    connectionString.startsWith('prisma://') ||
    connectionString.startsWith('prisma+postgres://')

  if (isAccelerateUrl) {
    return new PrismaClient({
      accelerateUrl: connectionString,
      log
    } as any)
  }

  console.log(`Database pool max configured: ${poolMax}`)

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: poolMax, connectionTimeoutMillis, ssl: { rejectUnauthorized: false } }),
    log
  } as any)
}

const existingPrisma = globalForPrisma.prisma
export const db = !existingPrisma ? createPrismaClient() : existingPrisma

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
