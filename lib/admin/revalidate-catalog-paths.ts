import { revalidatePath } from 'next/cache'

/** Invalidate admin catalog pages after dpmatch/dbrands_match approvals. */
export function revalidateAdminCatalogPaths() {
  const paths = [
    '/admin/products',
    '/admin/brands',
    '/tr/admin/products',
    '/en/admin/products',
    '/tr/admin/brands',
    '/en/admin/brands'
  ]
  for (const path of paths) {
    revalidatePath(path)
  }
}
