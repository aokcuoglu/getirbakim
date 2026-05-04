/**
 * Normalizes category image path from database.
 * Handles:
 * - Full URLs (http/https) -> use directly (legacy support)
 * - Supabase Storage paths (just filename) -> convert to full URL
 * - Paths starting with / -> use directly
 * - Relative filenames -> prefix with /categories/
 */
export function getCategoryImagePath(image: string | null | undefined): string | null {
  if (!image) return null
  
  // Full URL - use directly (legacy support for old data)
  if (image.startsWith('http://') || image.startsWith('https://')) {
    return image
  }
  
  // Check if it's a Supabase Storage path (just filename, no slashes or very short)
  // Supabase Storage paths are typically just filenames like "1234567890-abc123.jpg"
  // If it doesn't start with / and doesn't contain /, it's likely a Supabase Storage filename
  if (!image.includes('/') && image.includes('.')) {
    // It's a Supabase Storage filename, convert to full URL
    const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL']
    if (supabaseUrl) {
      // Extract project reference from Supabase URL
      const projectRef = supabaseUrl.replace('https://', '').replace('http://', '').split('.')[0]
      return `${supabaseUrl}/storage/v1/object/public/category-images/${image}`
    }
    // Fallback: if Supabase URL not available, return as relative path
    return `/category-images/${image}`
  }
  
  // Already a path starting with / - use directly
  if (image.startsWith('/')) {
    return image
  }
  
  // Relative filename - prefix with /categories/
  return `/categories/${image}`
}
