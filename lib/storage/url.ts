export function getPublicUrl(
  storagePath: string,
  bucket = 'part-images'
): string {
  return `/api/storage/${bucket}/${storagePath.replace(/^\//, '')}`
}

export function getStoragePublicUrl(storagePath: string, bucket = 'part-images'): string {
  return getPublicUrl(storagePath, bucket)
}

export function extractFilenameFromPath(urlPath: string): string {
  const parts = urlPath.split('/')
  return parts[parts.length - 1]
}
