import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Add it to your .env file (see .env.example for other vars).'
    )
  }

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
    adapter: new PrismaPg({ connectionString, max: 10, ssl: { rejectUnauthorized: false } }),
    log
  } as any)
}

const existingPrisma = globalForPrisma.prisma
const requiredModelDelegates = [
  'part_reference_links',
  'customer_requests',
  'order_payments',
  'supplier_product_oems'
] as const

const shouldRecreateClient =
  !!existingPrisma &&
  requiredModelDelegates.some(
    (modelName) =>
      !(modelName in (existingPrisma as unknown as Record<string, unknown>))
  )

export const db =
  !existingPrisma || shouldRecreateClient
    ? createPrismaClient()
    : existingPrisma

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
