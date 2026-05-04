export function normalizeAdminUrl(path: string, locale: string): string {
  // Remove leading slash if present to avoid double slash
  const cleanPath = path.startsWith('/') ? path : `/${path}`

  // If path already contains locale, return it as is
  if (cleanPath.startsWith(`/${locale}/`)) {
    return cleanPath
  }

  return `/${locale}/admin${cleanPath === '/' ? '' : cleanPath}`.replace(
    /\/+$/,
    ''
  )
}
