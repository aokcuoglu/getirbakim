'use server'

import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { requireAdminAuth } from '@/lib/admin-auth'
import { db } from '@/lib/db'
import {
  fetchDinamikItemsForBrand,
  syncDproductsForBrand,
  syncDproductsFromDbrands
} from '@/lib/admin/dnprd-stock-sync'
import type { DproductsStockSyncResult } from '@/lib/types/dnprd-sync'

function revalidateDproductsPaths() {
  revalidatePath('/admin/suppliers')
  revalidatePath('/admin/suppliers/dinamik')
  revalidatePath('/admin/eslestirme')
  revalidatePath('/admin/products')
}

export async function runDinamikDproductsStockSync(input?: {
  apply?: boolean
  brand?: string | null
  limitBrands?: number | null
  fetchPrices?: boolean
}): Promise<{
  success: boolean
  data?: DproductsStockSyncResult
  message?: string
}> {
  try {
    await requireAdminAuth()

    const data = await syncDproductsFromDbrands({
      dryRun: !input?.apply,
      brand: input?.brand,
      limitBrands: input?.limitBrands,
      fetchPrices: input?.fetchPrices !== false
    })

    if (input?.apply) {
      revalidateDproductsPaths()
    }

    const mode = input?.apply ? 'Uygulandı' : 'Önizleme (DRY_RUN)'
    const scope = input?.brand?.trim()
      ? `marka: ${input.brand.trim()}`
      : input?.limitBrands
        ? `ilk ${input.limitBrands} marka`
        : 'tüm dnbrd'

    const errorDetail =
      data.failedBrands > 0 && data.errors.length > 0
        ? ` İlk hata: ${data.errors[0]}`
        : ''

    return {
      success: data.failedBrands === 0,
      data,
      message: `${mode} (${scope}): ${data.brandsProcessed} marka, ${data.fetchedTotal.toLocaleString('tr-TR')} API satırı, ${data.upsertedTotal.toLocaleString('tr-TR')} güncellendi, ${data.markedPassiveTotal.toLocaleString('tr-TR')} pasif işaretlendi${data.failedBrands > 0 ? `, ${data.failedBrands} marka hata` : ''}.${errorDetail}`
    }
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : 'dnprd stok senkronu başarısız.'
    }
  }
}

export async function previewDinamikStockListForBrand(input: {
  brand: string
  persist?: boolean
  fetchPrices?: boolean
}): Promise<{
  success: boolean
  message?: string
  fetched?: number
  upserted?: number
  sample?: Array<{
    stokKodu: string
    stokAdi: string | null
    marka: string | null
    fiyat: number | null
  }>
}> {
  try {
    await requireAdminAuth()

    const brand = input.brand?.trim()
    if (!brand) {
      return { success: false, message: 'getStockList için marka girin.' }
    }

    if (input.persist) {
      const result = await syncDproductsForBrand(brand, {
        dryRun: false,
        fetchPrices: input.fetchPrices !== false
      })
      revalidateDproductsPaths()

      if (result.failed) {
        return {
          success: false,
          message: result.error || 'dnprd yazımı başarısız.'
        }
      }

      const sampleRows = await db.$queryRaw<
        Array<{
          stock_code: string
          stock_name: string | null
          brand: string | null
          price: string | null
        }>
      >(Prisma.sql`
        SELECT
          d.stock_code,
          d.stock_name,
          db.brand,
          o.price::text AS price
        FROM v0.dnmk_products d
        INNER JOIN v0.dnmk_brands db ON db.id = d.dnmk_brands_id
        LEFT JOIN v0.dnmk_cost o ON o.dnmk_products_id = d.id
        WHERE db.brand = ${brand}
        ORDER BY d.updated_at DESC NULLS LAST
        LIMIT 5
      `)

      return {
        success: true,
        message: `${brand}: ${result.fetched} satır çekildi, ${result.upserted} dnprd güncellendi.`,
        fetched: result.fetched,
        upserted: result.upserted,
        sample: sampleRows.map((row) => ({
          stokKodu: row.stock_code,
          stokAdi: row.stock_name,
          marka: row.brand,
          fiyat: row.price != null ? Number(row.price) : null
        }))
      }
    }

    const items = await fetchDinamikItemsForBrand(brand, {
      fetchPrices: input.fetchPrices !== false
    })

    return {
      success: true,
      message: `${brand} için ${items.length} stok satırı döndü (kayıt yok).`,
      fetched: items.length,
      sample: items.slice(0, 5).map((row) => ({
        stokKodu: row.stokKodu,
        stokAdi: row.stokAdi,
        marka: row.marka,
        fiyat: row.fiyat
      }))
    }
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : 'getStockList testi başarısız.'
    }
  }
}
