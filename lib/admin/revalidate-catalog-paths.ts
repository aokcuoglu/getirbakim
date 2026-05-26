import { revalidatePath, revalidateTag } from 'next/cache'
import { V0_APPROVED_BRANDS_CACHE_TAG } from '@/lib/v0/brandCache'

/** Invalidate admin catalog pages after dpmatch/dbrands_match approvals. */
export function revalidateAdminCatalogPaths() {
  revalidateTag(V0_APPROVED_BRANDS_CACHE_TAG, 'max')

  const paths = [
    '/admin/products',
    '/admin/brands',
    '/tr/admin/products',
    '/en/admin/products',
    '/tr/admin/brands',
    '/en/admin/brands',
    '/tr',
    '/en'
  ]
  for (const path of paths) {
    revalidatePath(path)
  }
}
