import { Prisma } from '@prisma/client'

/**
 * SQL fragment: normalize a part/OEM code the same way as
 * normalizeOem/normalizeSku in lib/matching/code-normalization.ts
 * (UPPER + strip [^A-Z0-9], empty → NULL).
 */
export function normCodeSql(expr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`NULLIF(UPPER(REGEXP_REPLACE(COALESCE(${expr}, ''), '[^A-Z0-9]', '', 'gi')), '')`
}

export const SUPPLIER_DINAMIK = 'dinamik'
export const SUPPLIER_BASBUG = 'basbug'
