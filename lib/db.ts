import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Add it to .env file (see .env.example for other vars).'
    )
  }

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

  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: 50,
      connectionTimeoutMillis,
      ssl: { rejectUnauthorized: false }
    }),
    log
  } as any)
}


const prisma = globalForPrisma.prisma ?? createPrismaClient()
export const db = prisma

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = prisma
}
