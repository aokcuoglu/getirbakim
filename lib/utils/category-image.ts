import { getPublicUrl } from '@/lib/storage/url'

export function getCategoryImagePath(image: string | null | undefined): string | null {
  if (!image) return null

  // Full URL - use directly (legacy support for old data)
  if (image.startsWith('http://') || image.startsWith('https://')) {
    return image
  }

  // Check if it's a storage path (just filename, no slashes or very short)
  if (!image.includes('/') && image.includes('.')) {
    return getPublicUrl(image, 'category-images')
  }

  // Already a path starting with / - use directly
  if (image.startsWith('/')) {
    return image
  }

  // Relative filename - prefix with /categories/
  return `/categories/${image}`
}
