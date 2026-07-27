import { NextRequest } from 'next/server'
import { errorResponse, requireAdmin, successResponse } from '@/lib/api/route-utils'
import {
  extensionForRemoteContentType,
  fetchSafeRemoteImage,
  REMOTE_IMAGE_MAX_BYTES
} from '@/lib/http/safe-remote-image'
import { uploadFile, STORAGE_BUCKETS } from '@/lib/storage'
import { addCatalogProductImage } from '@/lib/actions/admin-catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUCKET = STORAGE_BUCKETS.PRODUCTS
const STORAGE_PREFIX = 'catalog'
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml'
])

/**
 * Kanonik ürüne manuel görsel ekler (admin ürün detay sheet'i).
 *
 * İki giriş yolu var, ikisi de aynı yerde biter: dosya ya da harici URL →
 * storage'a yazılır → catalog.product_images'a source='MANUAL' satırı düşer.
 * Harici adres doğrudan DB'ye yazılmaz; kaynak site görseli kaldırırsa vitrin
 * kırık kalmasın diye kopyası alınır (marka logosu akışıyla aynı politika).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response, context } = await requireAdmin(request, {
    keyPrefix: 'admin:catalog:products:images',
    limit: 60,
    windowMs: 60_000
  })
  if (response) return response

  const { id } = await params
  if (!/^\d+$/.test(id)) {
    return errorResponse({
      status: 400,
      code: 'INVALID_ID',
      message: 'Geçersiz ürün kimliği.',
      context
    })
  }

  try {
    const formData = await request.formData()
    const file = formData.get('file')
    const urlField = formData.get('url')
    const imageUrl = typeof urlField === 'string' ? urlField.trim() : ''

    const hasFile = file instanceof File && file.size > 0
    const hasUrl = imageUrl.length > 0

    if (hasFile === hasUrl) {
      return errorResponse({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Görsel dosyası VEYA görsel URL’si gerekli (ikisi birden değil).',
        context
      })
    }

    let buffer: Uint8Array
    let contentType: string

    if (hasFile) {
      const upload = file as File
      if (!ALLOWED_TYPES.has(upload.type)) {
        return errorResponse({
          status: 400,
          code: 'INVALID_FILE_TYPE',
          message: 'Desteklenmeyen dosya türü.',
          context
        })
      }
      if (upload.size > REMOTE_IMAGE_MAX_BYTES) {
        return errorResponse({
          status: 400,
          code: 'FILE_TOO_LARGE',
          message: 'Görsel en fazla 2 MB olabilir.',
          context
        })
      }
      buffer = new Uint8Array(await upload.arrayBuffer())
      contentType = upload.type
    } else {
      const remote = await fetchSafeRemoteImage(imageUrl)
      if (!remote.ok) {
        return errorResponse({
          status: 400,
          code: remote.code,
          message: remote.message,
          context
        })
      }
      buffer = remote.buffer
      contentType = remote.contentType
    }

    const ext = extensionForRemoteContentType(contentType)
    const storagePath = `${STORAGE_PREFIX}/${id}-${Date.now()}.${ext}`
    const stored = await uploadFile(buffer, storagePath, contentType, BUCKET)
    if (!stored.publicUrl) {
      return errorResponse({
        status: 500,
        code: 'UPLOAD_FAILED',
        message: stored.error ?? 'Görsel yüklenemedi.',
        context
      })
    }

    const result = await addCatalogProductImage({ id, url: stored.publicUrl })
    if (!result.success) {
      return errorResponse({
        status: 400,
        code: 'SAVE_FAILED',
        message: result.message,
        context
      })
    }

    return successResponse(
      { images: result.images, primaryImageUrl: result.primaryImageUrl, message: result.message },
      context
    )
  } catch (error) {
    console.error('[admin:catalog:products:images] Error:', error)
    return errorResponse({
      status: 500,
      code: 'UPLOAD_FAILED',
      message: 'Görsel yüklenirken hata oluştu.',
      context
    })
  }
}
