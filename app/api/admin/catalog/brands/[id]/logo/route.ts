import { NextRequest } from 'next/server'
import { revalidateAdminCatalogPaths } from '@/lib/admin/revalidate-catalog-paths'
import {
  getApprovedDbrandsMatchById,
  setApprovedDbrandsMatchLogo
} from '@/lib/admin/approved-dnbrd-catalog'
import { getAdminAuth } from '@/lib/admin-auth'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'
import {
  extensionForRemoteContentType,
  fetchSafeRemoteImage,
  REMOTE_IMAGE_MAX_BYTES
} from '@/lib/http/safe-remote-image'
import { ensureStorageBucket } from '@/lib/suppliers/parts2world/common'
import { uploadImageBuffer } from '@/lib/supabase/storage'

const BUCKET = 'brand-logos'
const STORAGE_PREFIX = 'ptbrands'
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml'
])

function extensionForContentType(contentType: string): string {
  return extensionForRemoteContentType(contentType)
}

type LogoRouteContext = ReturnType<typeof withApiContext>['context']

async function persistBrandLogo(
  matchId: number,
  buffer: Uint8Array,
  contentType: string,
  context: LogoRouteContext
) {
  await ensureStorageBucket(BUCKET, true)
  const ext = extensionForContentType(contentType)
  const storagePath = `${STORAGE_PREFIX}/${matchId}-${Date.now()}.${ext}`
  const upload = await uploadImageBuffer(buffer, storagePath, contentType, BUCKET)

  if (!upload.publicUrl) {
    return errorResponse({
      status: 500,
      code: 'UPLOAD_FAILED',
      message: upload.error ?? 'Logo yüklenemedi.',
      context
    })
  }

  const updated = await setApprovedDbrandsMatchLogo(matchId, upload.publicUrl)
  if (!updated) {
    return errorResponse({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Marka eşleştirmesi güncellenemedi.',
      context
    })
  }

  revalidateAdminCatalogPaths()

  return successResponse(
    {
      id: matchId,
      logoUrl: upload.publicUrl,
      message: 'Logo yüklendi.'
    },
    context
  )
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'admin:catalog:brands:logo',
    limit: 60,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse
  if (!auth?.user) {
    return errorResponse({
      status: 401,
      code: 'UNAUTHENTICATED',
      message: 'Authentication required.',
      context
    })
  }
  if (auth.user.role !== 'ADMIN') {
    return errorResponse({
      status: 403,
      code: 'ADMIN_REQUIRED',
      message: 'Admin access required.',
      context
    })
  }

  const { id: idStr } = await params
  const matchId = parseInt(idStr, 10)
  if (Number.isNaN(matchId) || matchId <= 0) {
    return errorResponse({
      status: 400,
      code: 'INVALID_ID',
      message: 'Geçersiz marka eşleştirme ID.',
      context
    })
  }

  const row = await getApprovedDbrandsMatchById(matchId)
  if (!row) {
    return errorResponse({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Onaylı marka eşleştirmesi bulunamadı.',
      context
    })
  }

  const formData = await request.formData()
  const file = formData.get('file')
  const urlField = formData.get('url')
  const imageUrl = typeof urlField === 'string' ? urlField.trim() : ''

  const hasFile = file instanceof File
  const hasUrl = imageUrl.length > 0

  if (hasFile && hasUrl) {
    return errorResponse({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Dosya ve URL birlikte gönderilemez.',
      context
    })
  }

  if (!hasFile && !hasUrl) {
    return errorResponse({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Logo dosyası veya görsel URL’si gerekli.',
      context
    })
  }

  try {
    if (hasFile) {
      if (!ALLOWED_TYPES.has(file.type)) {
        return errorResponse({
          status: 400,
          code: 'INVALID_FILE_TYPE',
          message: 'Desteklenmeyen dosya türü.',
          context
        })
      }

      if (file.size > REMOTE_IMAGE_MAX_BYTES) {
        return errorResponse({
          status: 400,
          code: 'FILE_TOO_LARGE',
          message: 'Logo dosyası en fazla 2 MB olabilir.',
          context
        })
      }

      const buffer = new Uint8Array(await file.arrayBuffer())
      return await persistBrandLogo(matchId, buffer, file.type, context)
    }

    // URL yolu
    const supabaseBase = process.env['NEXT_PUBLIC_SUPABASE_URL']!
    const cleanedSupabase = supabaseBase.replace(/\/$/, '')
    const isSupabaseUrl =
      imageUrl.startsWith(cleanedSupabase) &&
      imageUrl.includes('/storage/v1/object/public/')

    // Desteklenmeyen protokol kontrolü
    if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
      return errorResponse({
        status: 400,
        code: 'INVALID_URL',
        message: 'Geçerli bir URL giriniz.',
        context
      })
    }

    // Supabase'ten gelen URL → doğrudan DB'ye kaydet
    if (isSupabaseUrl) {
      const updated = await setApprovedDbrandsMatchLogo(matchId, imageUrl)
      if (!updated) {
        return errorResponse({
          status: 404,
          code: 'NOT_FOUND',
          message: 'Marka eşleştirmesi güncellenemedi.',
          context
        })
      }

      revalidateAdminCatalogPaths()

      return successResponse(
        {
          id: matchId,
          logoUrl: imageUrl,
          message: 'Logo bağlandı.'
        },
        context
      )
    }

    // Harici URL → indir, kontrol et, yükle
    const remote = await fetchSafeRemoteImage(imageUrl)
    if (!remote.ok) {
      return errorResponse({
        status: 400,
        code: remote.code,
        message: remote.message,
        context
      })
    }

    return await persistBrandLogo(matchId, remote.buffer, remote.contentType, context)
  } catch (error) {
    console.error('[admin:catalog:brands:logo] Error:', error)
    return errorResponse({
      status: 500,
      code: 'UPLOAD_FAILED',
      message: 'Logo yüklenirken hata oluştu.',
      context
    })
  }
}
