import { createClient } from '@supabase/supabase-js'
import { resolveSiteUrl } from '@/lib/site-url'

const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL']!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

/**
 * Admin Supabase client for server-side operations (uploads, etc.)
 * Uses service role key for elevated permissions
 */
export function createAdminClient() {
  if (!supabaseServiceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })
}

/**
 * Upload an image from a URL to Supabase Storage
 * @param sourceUrl - Full URL to download image from
 * @param storagePath - Path in Supabase Storage (e.g., "images/abc123.jpg")
 * @param bucket - Storage bucket name (default: "part-images")
 * @returns Public URL of uploaded image or null on failure
 */
export type UploadImageFromUrlOptions = {
  bucket?: string
  /** Override Referer/Origin for hotlink-protected sources (e.g. parcatedarik.com). */
  referer?: string
}

export async function uploadImageFromUrl(
  sourceUrl: string,
  storagePath: string,
  bucketOrOptions: string | UploadImageFromUrlOptions = 'part-images'
): Promise<{ publicUrl: string | null; status?: number; error?: string }> {
  const options =
    typeof bucketOrOptions === 'string'
      ? { bucket: bucketOrOptions }
      : bucketOrOptions
  const bucket = options.bucket ?? 'part-images'
  const supabase = createAdminClient()

  try {
    const siteUrl = resolveSiteUrl()
    const referer = options.referer ?? siteUrl

    // Fetch the image with proper headers to avoid 403 errors
    const response = await fetch(sourceUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': referer,
        'Origin': referer,
        'Cache-Control': 'no-cache'
      }
    })

    if (!response.ok) {
      console.error(`Failed to fetch image: ${sourceUrl} - ${response.status}`)
      return { publicUrl: null, status: response.status }
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg'
    const arrayBuffer = await response.arrayBuffer()
    const buffer = new Uint8Array(arrayBuffer)

    // Upload to Supabase Storage
    const { error } = await supabase.storage
      .from(bucket)
      .upload(storagePath, buffer, {
        contentType,
        upsert: true
      })

    if (error) {
      console.error(`Failed to upload: ${storagePath}`, error.message)
      return { publicUrl: null, error: error.message }
    }

    // Get public URL
    const {
      data: { publicUrl }
    } = supabase.storage.from(bucket).getPublicUrl(storagePath)

    return { publicUrl }
  } catch (error: any) {
    console.error(`Error processing image: ${sourceUrl}`, error)
    return { publicUrl: null, error: error.message }
  }
}

/**
 * Get the public URL for a file in Supabase Storage
 * @param storagePath - Path in storage (e.g., "images/abc123.jpg")
 * @param bucket - Storage bucket name
 */
export function getStoragePublicUrl(
  storagePath: string,
  bucket: string = 'part-images'
): string {
  const supabase = createAdminClient()
  const {
    data: { publicUrl }
  } = supabase.storage.from(bucket).getPublicUrl(storagePath)
  return publicUrl
}

/**
 * Extract filename from a parts2world URL path
 * e.g., "/_debug/tecdoc-images/4f/22/fe/4f22fea6ef242280ba9a6d2cc2a3a324.jpg"
 * returns "4f22fea6ef242280ba9a6d2cc2a3a324.jpg"
 */
export function extractFilenameFromPath(urlPath: string): string {
  const parts = urlPath.split('/')
  return parts[parts.length - 1]
}

/**
 * Check if a file already exists in Supabase Storage
 */
export async function uploadImageBuffer(
  buffer: Uint8Array,
  storagePath: string,
  contentType: string,
  bucket: string = 'part-images'
): Promise<{ publicUrl: string | null; error?: string }> {
  const supabase = createAdminClient()

  const { error } = await supabase.storage.from(bucket).upload(storagePath, buffer, {
    contentType,
    upsert: true
  })

  if (error) {
    console.error(`Failed to upload buffer: ${storagePath}`, error.message)
    return { publicUrl: null, error: error.message }
  }

  return { publicUrl: getStoragePublicUrl(storagePath, bucket) }
}

export async function fileExistsInStorage(
  storagePath: string,
  bucket: string = 'part-images'
): Promise<boolean> {
  const supabase = createAdminClient()

  const { data, error } = await supabase.storage
    .from(bucket)
    .list(storagePath.split('/').slice(0, -1).join('/'), {
      search: storagePath.split('/').pop()
    })

  if (error) return false
  return data && data.length > 0
}
