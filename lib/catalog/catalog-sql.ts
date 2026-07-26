import { Prisma } from '@prisma/client'

/**
 * SQL fragment: normalize a part/OEM code the same way as
 * normalizeOem/normalizeSku in lib/matching/code-normalization.ts
 * (UPPER + strip [^A-Z0-9], empty → NULL).
 */
export function normCodeSql(expr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`NULLIF(UPPER(REGEXP_REPLACE(COALESCE(${expr}, ''), '[^A-Z0-9]', '', 'gi')), '')`
}

/**
 * SQL fragment: is `expr` a real barcode (GTIN-8/12/13/14)?
 *
 * Mirrors isValidGtin in lib/catalog/gtin.ts — change one, change the other.
 * They are separate because the supplier ingest validates millions of rows
 * inside a single INSERT ... SELECT; routing that through the application
 * would mean pulling the whole supplier catalogue into memory.
 *
 * Space and hyphen count as separators ("869 123 4567890"); any other
 * non-digit character disqualifies the value outright. Stripping letters
 * instead would turn part numbers into barcodes — "ABA-10PK1342" reduced to
 * digits is what filled this table with junk in the first place.
 */
export function validGtinSql(expr: Prisma.Sql): Prisma.Sql {
  const trimmed = Prisma.sql`BTRIM(COALESCE(${expr}, ''))`
  const digits = Prisma.sql`REGEXP_REPLACE(${trimmed}, '[\\s-]', '', 'g')`
  return Prisma.sql`(
    ${trimmed} ~ '^[0-9[:space:]-]+$'
    AND LENGTH(${digits}) IN (8, 12, 13, 14)
    AND ${digits} !~ '^0+$'
    -- Kontrol hanesi: son hane dışındakiler sağdan sola 3,1,3,1… ile çarpılır,
    -- toplamın 10'a tamamlayanı son haneye eşit olmalı.
    AND (10 - (
      SELECT COALESCE(SUM(
        SUBSTR(${digits}, g.i, 1)::int
        * CASE WHEN (LENGTH(${digits}) - g.i) % 2 = 1 THEN 3 ELSE 1 END
      ), 0)
      FROM GENERATE_SERIES(1, LENGTH(${digits}) - 1) AS g(i)
    ) % 10) % 10 = SUBSTR(${digits}, LENGTH(${digits}), 1)::int
  )`
}

/** SQL fragment: barcode reduced to its digits (separators removed). */
export function gtinDigitsSql(expr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`REGEXP_REPLACE(BTRIM(COALESCE(${expr}, '')), '[\\s-]', '', 'g')`
}

export const SUPPLIER_DINAMIK = 'dinamik'
export const SUPPLIER_BASBUG = 'basbug'
