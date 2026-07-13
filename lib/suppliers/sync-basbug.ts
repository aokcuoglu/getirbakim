import 'server-only'

import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  getListeGruplari,
  getMalzemeler,
  getDovizBilgisi,
  type BasbugListeGrubu,
  type BasbugMalzeme
} from '@/lib/suppliers/basbug-client'

const BATCH_SIZE = 500

const DEFAULT_PROVIDER_CONFIG = {
  loginPath: '/auth/Login',
  listGroupsPath: '/material/ListeGrubuGetir',
  productsPath: '/material/MalzemeleriGetir',
  productSearchPath: '/material/MalzemeAra',
  priceListPath: '/material/FiyatGetir',
  dovizBilgisiPath: '/material/DovizBilgisiGetir',
  firmaAdi: 'BASBUG',
  supportsRealtimeStock: false
} satisfies Record<string, unknown>

type BasbugCatalogSeedBrandSummary = {
  listeGrubu: string
  fetched: number
  staged: number
  failed: number
}

export interface BasbugCatalogSeedOptions {
  listeGruplari?: string[]
  limitGroups?: number
}

export interface BasbugCatalogSeedResult {
  status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED'
  groupCount: number
  totalCount: number
  successCount: number
  failedCount: number
  brands: BasbugCatalogSeedBrandSummary[]
  errors: string[]
}

export interface BasbugRateSyncResult {
  status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED'
  fetched: number
  upserted: number
  errors: string[]
}

function normalizeText(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text.length ? text : null
}

function normalizeNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function toDecimal(value: number | null): Prisma.Decimal | null {
  if (value == null || !Number.isFinite(value)) return null
  return new Prisma.Decimal(value)
}

function mapCurrency(dc: string): string {
  const upper = dc.trim().toUpperCase()
  if (upper === 'TL') return 'TRY'
  return upper
}

async function chunk<T, R>(
  items: T[],
  size: number,
  worker: (batch: T[]) => Promise<R>
): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await worker(items.slice(i, i + size))
  }
}

export async function runBasbugCatalogSeedJob(
  options: BasbugCatalogSeedOptions = {}
): Promise<BasbugCatalogSeedResult> {
  const errors: string[] = []
  const brandSummaries: BasbugCatalogSeedBrandSummary[] = []
  let totalCount = 0
  let successCount = 0
  let failedCount = 0

  try {
    const groups = await getListeGruplari()
    let filteredGroups = groups

    if (options.listeGruplari && options.listeGruplari.length > 0) {
      const kodSet = new Set(options.listeGruplari.map((k) => k.toUpperCase()))
      filteredGroups = groups.filter((g) => kodSet.has(g.kod.toUpperCase()))
    }

    if (options.limitGroups && options.limitGroups > 0) {
      filteredGroups = filteredGroups.slice(0, options.limitGroups)
    }

    for (const group of filteredGroups) {
      let fetched = 0
      let staged = 0
      let failed = 0

      try {
        const malzemeler = await getMalzemeler(group.kod)
        fetched = malzemeler.length
        totalCount += fetched

        const distinctBrands = new Map<string, string>()
        const currencyRates = new Map<string, number>()

        for (const m of malzemeler) {
          const brand = m.uk || 'BİLİNMEYEN'
          distinctBrands.set(brand, brand)

          const curr = mapCurrency(m.dc)
          if (curr !== 'TRY' && curr !== 'TL' && !currencyRates.has(curr)) {
            const rate = await getLatestRate(curr)
            if (rate && rate.kurDegeri !== null) {
              currencyRates.set(curr, rate.kurDegeri)
            }
          }
        }

        const brandIds = new Map<string, bigint>()
        for (const brand of distinctBrands.values()) {
          const result = await db.supplier_basbug_brands.upsert({
            where: { brand },
            update: { last_seen_at: new Date() },
            create: { brand },
            select: { id: true }
          })
          brandIds.set(brand, result.id)
        }

        await chunk(malzemeler, BATCH_SIZE, async (batch) => {
          await db.supplier_basbug_products.createMany({
            data: batch.map((m) => {
              const currency = mapCurrency(m.dc)
              const bsbgBrandsId = brandIds.get(m.uk || 'BİLİNMEYEN')!
              return {
                brand_id: bsbgBrandsId,
                malzeme_no: m.no,
                part_no: (m.uk?.toUpperCase() === 'OE-FD' || m.uk?.toUpperCase() === 'VIEW MAX' || m.uk?.toUpperCase() === 'CONTITECH' || m.uk?.toUpperCase() === 'R' || m.uk?.toUpperCase() === 'FMY' || m.uk?.toUpperCase() === 'ARI IS') ? m.no : (() => { const i = m.no.indexOf(' '); return i > 0 ? m.no.slice(i + 1).trim() || null : null })(),
                aciklama: normalizeText(m.ac),
                aciklama2: normalizeText(m.ac2),
                oem_no: normalizeText(m.oe),
                liste_grubu_kodu: m.lgk,
                arac_bilgisi: normalizeText(m.m),
                motor_bilgisi: normalizeText(m.mo),
                yil_araligi: normalizeText(m.y),
                birim: normalizeText(m.b),
                para_birimi: currency,
                liste_fiyati: toDecimal(m.lf),
                raw: m as unknown as Prisma.InputJsonValue,
                last_seen_at: new Date()
              }
            }),
            skipDuplicates: true
          })

          staged += batch.length
          successCount += batch.length
        })

        brandSummaries.push({ listeGrubu: group.kod, fetched, staged, failed })
      } catch (error) {
        failedCount += 1
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`Grup ${group.kod}: ${message}`)
        brandSummaries.push({ listeGrubu: group.kod, fetched: 0, staged: 0, failed: 1 })
      }
    }

    const status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' =
      failedCount === 0
        ? 'SUCCESS'
        : successCount > 0
          ? 'PARTIAL_SUCCESS'
          : 'FAILED'

    return {
      status,
      groupCount: filteredGroups.length,
      totalCount,
      successCount,
      failedCount,
      brands: brandSummaries,
      errors: errors.slice(0, 50)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    errors.unshift(`Genel hata: ${message}`)

    return {
      status: 'FAILED',
      groupCount: 0,
      totalCount,
      successCount,
      failedCount: failedCount + 1,
      brands: brandSummaries,
      errors: errors.slice(0, 50)
    }
  }
}

function toDecimalFromString(value: string): Prisma.Decimal {
  const trimmed = value.replace(/^0+/, '0')
  const sanitized = trimmed.replace(/\.+/g, (match) =>
    match.length > 1 ? '.' : match
  )
  return new Prisma.Decimal(sanitized)
}

async function getLatestRate(currency: string): Promise<{
  kurDegeri: number | null
  fiyatTl: number | null
} | null> {
  if (currency === 'TRY' || currency === 'TL') {
    return { kurDegeri: null, fiyatTl: null }
  }

  const rate = await db.supplier_basbug_rates.findFirst({
    where: { doviz_cinsi: currency },
    orderBy: { tarih: 'desc' },
    select: { satis: true }
  })

  if (!rate) return null

  return {
    kurDegeri: Number(rate.satis),
    fiyatTl: null
  }
}

export async function runBasbugRateSyncJob(): Promise<BasbugRateSyncResult> {
  const errors: string[] = []
  let fetched = 0
  let upserted = 0

  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const rates = await getDovizBilgisi()
    fetched = rates.length

    for (const rate of rates) {
      try {
        await db.supplier_basbug_rates.upsert({
          where: {
            doviz_cinsi_kaynak_tarih: {
              doviz_cinsi: rate.dovizCinsi,
              kaynak: 'BASBUG',
              tarih: today
            }
          },
          update: {
            alis: toDecimalFromString(rate.alis),
            satis: toDecimalFromString(rate.satis)
          },
          create: {
            doviz_cinsi: rate.dovizCinsi,
            alis: toDecimalFromString(rate.alis),
            satis: toDecimalFromString(rate.satis),
            kaynak: 'BASBUG',
            tarih: today
          }
        })
        upserted += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`Kur ${rate.dovizCinsi}: ${message}`)
      }
    }

    const status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' =
      errors.length === 0
        ? 'SUCCESS'
        : upserted > 0
          ? 'PARTIAL_SUCCESS'
          : 'FAILED'

    return {
      status,
      fetched,
      upserted,
      errors: errors.slice(0, 20)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    errors.unshift(`Genel hata: ${message}`)

    return {
      status: 'FAILED',
      fetched,
      upserted,
      errors: errors.slice(0, 20)
    }
  }
}