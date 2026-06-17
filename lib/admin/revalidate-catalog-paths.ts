import { revalidatePath, revalidateTag } from 'next/cache'
import { V0_APPROVED_BRANDS_CACHE_TAG } from '@/lib/v0/brandCache'

/** Invalidate admin catalog pages after dpprd/dpbrd approvals. */
export function revalidateAdminCatalogPaths() {
  revalidateTag(V0_APPROVED_BRANDS_CACHE_TAG, 'max')

  const paths = [
    '/admin/products',
    '/admin/brands',
    '/admin/eslestirme',
    '/tr/admin/products',
    '/en/admin/products',
    '/tr/admin/brands',
    '/en/admin/brands',
    '/tr/admin/eslestirme',
    '/en/admin/eslestirme',
    '/tr',
    '/en'
  ]
  for (const path of paths) {
    revalidatePath(path)
  }
}

/**
 * Revalidate a base admin path across its locale-prefixed variants.
 *
 * Replaces the repeated 3-line block in lib/actions/admin-*.ts:
 *   revalidatePath('/admin/orders')
 *   revalidatePath('/tr/admin/orders')
 *   revalidatePath('/en/admin/orders')
 *
 * @param basePath base admin path, e.g. "/admin/orders" (no locale prefix)
 * @param includeRoot when true, also revalidate '/tr' and '/en' home pages
 *                    (useful when the admin change affects public listings)
 */
export function revalidateLocalizedAdminPath(
  basePath: string,
  options: { includeRoot?: boolean } = {}
): void {
  revalidatePath(basePath)
  revalidatePath(`/tr${basePath}`)
  revalidatePath(`/en${basePath}`)

  if (options.includeRoot) {
    revalidatePath('/tr')
    revalidatePath('/en')
  }
}
