import { NextRequest } from 'next/server'
import { revalidateAdminCatalogPaths } from '@/lib/admin/revalidate-catalog-paths'
import {
  getApprovedDbrandsMatchById,
  setApprovedDbrandsMatchLogo
} from '@/lib/admin/approved-dnbrd-catalog'
import { errorResponse, requireAdmin, successResponse } from '@/lib/api/route-utils'
import {
  extensionForRemoteContentType,
  fetchSafeRemoteImage,
  REMOTE_IMAGE_MAX_BYTES
} from '@/lib/http/safe-remote-image'
import { uploadFile, getStoragePublicUrl, fileExistsInStorage, STORAGE_BUCKETS } from '@/lib/storage'

const BUCKET = STORAGE_BUCKETS.BRAND_LOGOS
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

type LogoRouteContext = Awaited<ReturnType<typeof requireAdmin>>['context']

async function persistBrandLogo(
  matchId: number,
  buffer: Uint8Array,
  contentType: string,
  context: LogoRouteContext
) {
  const ext = extensionForContentType(contentType)
  const storagePath = `${STORAGE_PREFIX}/${matchId}-${Date.now()}.${ext}`
  const upload = await uploadFile(buffer, storagePath, contentType, BUCKET)

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
  const { response, context } = await requireAdmin(request, {
    keyPrefix: 'admin:catalog:brands:logo',
    limit: 60,
    windowMs: 60_000
  })
  if (response) return response

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
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const isLocalUrl =
      imageUrl.startsWith(appUrl) &&
      imageUrl.includes('/api/storage/')

    // Desteklenmeyen protokol kontrolü
    if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
      return errorResponse({
        status: 400,
        code: 'INVALID_URL',
        message: 'Geçerli bir URL giriniz.',
        context
      })
    }

    // Local storage'ten gelen URL → doğrudan DB'ye kaydet
    if (isLocalUrl) {
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
