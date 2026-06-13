import 'server-only'
import { resolveSiteUrl } from '@/lib/site-url'
import * as fs from 'fs'
import * as path from 'path'
import { getPublicUrl } from './url'

const STORAGE_ROOT = process.env.STORAGE_PATH || './data/storage'

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function getFilePath(bucket: string, storagePath: string): string {
  return path.join(STORAGE_ROOT, bucket, storagePath)
}

export async function uploadFile(
  buffer: Buffer | Uint8Array,
  storagePath: string,
  contentType?: string,
  bucket = 'part-images'
): Promise<{ publicUrl: string | null; error?: string }> {
  try {
    const filePath = getFilePath(bucket, storagePath)
    ensureDir(path.dirname(filePath))
    fs.writeFileSync(filePath, buffer)
    return { publicUrl: getPublicUrl(storagePath, bucket) }
  } catch (error: any) {
    console.error(`Failed to upload file: ${storagePath}`, error)
    return { publicUrl: null, error: error.message }
  }
}

export async function uploadImageFromUrl(
  sourceUrl: string,
  storagePath: string,
  bucketOrOptions: string | { bucket?: string; referer?: string } = 'part-images'
): Promise<{ publicUrl: string | null; status?: number; error?: string }> {
  const options =
    typeof bucketOrOptions === 'string'
      ? { bucket: bucketOrOptions }
      : bucketOrOptions
  const bucket = options.bucket ?? 'part-images'

  try {
    const siteUrl = resolveSiteUrl()
    const referer = options.referer ?? siteUrl

    const response = await fetch(sourceUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: referer,
        Origin: referer,
        'Cache-Control': 'no-cache',
      },
    })

    if (!response.ok) {
      console.error(`Failed to fetch image: ${sourceUrl} - ${response.status}`)
      return { publicUrl: null, status: response.status }
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    const result = await uploadFile(buffer, storagePath, undefined, bucket)
    return { publicUrl: result.publicUrl }
  } catch (error: any) {
    console.error(`Error processing image: ${sourceUrl}`, error)
    return { publicUrl: null, error: error.message }
  }
}

export { getPublicUrl, getStoragePublicUrl, extractFilenameFromUrl } from './url'

export async function fileExists(
  storagePath: string,
  bucket = 'part-images'
): Promise<boolean> {
  const filePath = getFilePath(bucket, storagePath)
  return fs.existsSync(filePath)
}

export async function fileExistsInStorage(
  storagePath: string,
  bucket = 'part-images'
): Promise<boolean> {
  return fileExists(storagePath, bucket)
}

export const STORAGE_BUCKETS = {
  CATEGORY_IMAGES: 'category-images',
  BRAND_LOGOS: 'brand-logos',
  PART_IMAGES: 'part-images',
  PART_DOCUMENTS: 'part-documents',
  PRODUCTS: 'products',
} as const

