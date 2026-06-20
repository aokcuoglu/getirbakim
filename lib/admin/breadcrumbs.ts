export interface AdminBreadcrumbItem {
  label: string
  href?: string
}

/** Exact-path labels aligned with sidebar navigation */
const ADMIN_ROUTE_LABELS: Record<string, string> = {
  '/admin': 'Genel Bakış',
  '/admin/products': 'Ürünler',
  '/admin/products/new': 'Yeni Ürün',
  '/admin/products/match': 'Eşleştirme',
  '/admin/products/tools': 'Araçlar',
  '/admin/brands': 'Markalar',
  '/admin/orders': 'Siparişler',
  '/admin/customers': 'Müşteriler',
  '/admin/categories': 'Kategoriler',
  '/admin/categories/new': 'Yeni Kategori',
  '/admin/requests': 'Talepler',
  '/admin/suppliers': 'Tedarikçiler',
  '/admin/suppliers/dinamik': 'Dinamik',
  '/admin/suppliers/match-products': 'Ürün Eşleştirme',
  '/admin/eslestirme': 'Eşleştirme'
}

/** Fallback segment labels for nested or dynamic routes */
const SEGMENT_LABELS: Record<string, string> = {
  products: 'Ürünler',
  brands: 'Markalar',
  orders: 'Siparişler',
  customers: 'Müşteriler',
  categories: 'Kategoriler',
  requests: 'Talepler',
  suppliers: 'Tedarikçiler',
  eslestirme: 'Eşleştirme',
  dinamik: 'Dinamik',
  'match-products': 'Ürün Eşleştirme',
  new: 'Yeni',
  tools: 'Araçlar',
  edit: 'Düzenle'
}

function normalizeAdminPath(pathname: string): string {
  const trimmed = pathname.replace(/\/$/, '')
  if (!trimmed || trimmed === '/admin') {
    return '/admin'
  }
  return trimmed.startsWith('/admin') ? trimmed : `/admin${trimmed}`
}

function resolveSegmentLabel(segment: string, fullPath: string): string {
  return ADMIN_ROUTE_LABELS[fullPath] ?? SEGMENT_LABELS[segment] ?? segment
}

/**
 * Build breadcrumb items for an admin route.
 * Home icon in AdminBreadcrumbs links to /admin (Genel Bakış).
 */
export function getAdminBreadcrumbs(
  pathname: string,
  options?: { currentLabel?: string }
): AdminBreadcrumbItem[] {
  const normalized = normalizeAdminPath(pathname)

  if (normalized === '/admin') {
    return [{ label: 'Genel Bakış' }]
  }

  const parts = normalized.split('/').filter(Boolean)
  if (parts[0] !== 'admin') {
    return []
  }

  const crumbs: AdminBreadcrumbItem[] = []
  let path = ''

  for (let i = 1; i < parts.length; i++) {
    const segment = parts[i]
    path += `/${segment}`
    const fullPath = `/admin${path}`
    const isLast = i === parts.length - 1

    if (/^\d+$/.test(segment)) {
      continue
    }

    const label =
      isLast && options?.currentLabel
        ? options.currentLabel
        : resolveSegmentLabel(segment, fullPath)

    if (isLast) {
      crumbs.push({ label })
    } else {
      crumbs.push({ label, href: fullPath })
    }
  }

  return crumbs
}
