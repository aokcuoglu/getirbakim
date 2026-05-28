'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminAuth } from '@/lib/admin-auth'
import {
  auditDbrandsMatch,
  seedDbrandsMatchWorkspace
} from '@/lib/admin/dbrands-match-seed'
import {
  auditDbrands,
  ensureDbrandsRows,
  reconcileDbrands
} from '@/lib/admin/dbrands-reconcile'
import type {
  DbrandsAudit,
  DbrandsMatchAudit,
  DbrandsMatchSeedResult,
  DbrandsReconcileResult
} from '@/lib/types/dbrands'
import { dinamikFetch } from '@/lib/dinamik'

function revalidateDbrandsPaths() {
  revalidatePath('/admin/suppliers')
  revalidatePath('/admin/suppliers/dinamik')
  revalidatePath('/admin/eslestirme')
}

export async function getDinamikDbrandsAudit(): Promise<{
  success: boolean
  data?: DbrandsAudit
  message?: string
}> {
  try {
    await requireAdminAuth()
    const data = await auditDbrands()
    return { success: true, data }
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : 'dbrands denetimi başarısız.'
    }
  }
}

export async function runDinamikDbrandsReconcile(input?: {
  apply?: boolean
  syncFromApi?: boolean
}): Promise<{
  success: boolean
  data?: DbrandsReconcileResult
  message?: string
}> {
  try {
    await requireAdminAuth()
    const data = await reconcileDbrands({
      dryRun: !input?.apply,
      syncFromApi: input?.syncFromApi !== false
    })

    if (input?.apply) {
      revalidateDbrandsPaths()
    }

    const mode = input?.apply ? 'Uygulandı' : 'Önizleme (DRY_RUN)'
    const remaining = data.audit.manufacturerOnlyInDbrands
    const remainingNote =
      remaining > 0
        ? ` Uyarı: ${remaining} marka hâlâ üretici adıyla eşleşiyor ve dproducts’ta ürün yok (ör. ${data.audit.sampleManufacturerOnly.slice(0, 3).join(', ')}).`
        : ''
    return {
      success: true,
      data,
      message: `${mode}: ${data.insertedFromApi} API + ${data.insertedFromDproducts} dproducts markası eklendi; API dışı üretici kopyalarından ${data.removedManufacturerOnly} satır silindi. Kalan uyarı: ${remaining}.${remainingNote}`
    }
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : 'dbrands düzeltmesi başarısız.'
    }
  }
}

export async function getDinamikDbrandsMatchAudit(): Promise<{
  success: boolean
  data?: DbrandsMatchAudit
  message?: string
}> {
  try {
    await requireAdminAuth()
    const data = await auditDbrandsMatch()
    return { success: true, data }
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : 'dbrands_match denetimi başarısız.'
    }
  }
}

export async function runDinamikDbrandsMatchSeed(input?: {
  apply?: boolean
  runAutoMatch?: boolean
}): Promise<{
  success: boolean
  data?: DbrandsMatchSeedResult
  message?: string
}> {
  try {
    await requireAdminAuth()
    const data = await seedDbrandsMatchWorkspace({
      dryRun: !input?.apply,
      runAutoMatch: input?.runAutoMatch !== false
    })

    if (input?.apply) {
      revalidateDbrandsPaths()
    }

    const mode = input?.apply ? 'Uygulandı' : 'Önizleme'
    return {
      success: true,
      data,
      message: `${mode}: −${data.removedRedundantStubs} fazla stub, +${data.insertedDinamikStubs} Dinamik stub, +${data.insertedPtOnly} PT-only, +${data.insertedAutoMatched} otomatik eşleşme. Toplam: ${data.matchTotalAfter}.`
    }
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : 'dbrands_match doldurma başarısız.'
    }
  }
}

export async function syncDinamikDbrandsFromBrandList(): Promise<{
  success: boolean
  message: string
  inserted?: number
  apiBrandCount?: number
}> {
  try {
    await requireAdminAuth()
    const apiBrandsResponse = await dinamikFetch('/api/Dnmk_Customer/getBrandList')
    const apiBrands: Array<{ brand: string }> = await apiBrandsResponse.json()
    const names = apiBrands.map((b: { brand: string }) => b.brand).filter(Boolean)
    const inserted = await ensureDbrandsRows(names)
    revalidateDbrandsPaths()
    return {
      success: true,
      message: `${apiBrands.length} API markası tarandı, ${inserted} yeni dbrands kaydı eklendi.`,
      inserted,
      apiBrandCount: apiBrands.length
    }
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : 'API marka senkronu başarısız.'
    }
  }
}
