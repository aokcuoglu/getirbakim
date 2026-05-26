import 'server-only'

export const V0_CATALOG_INDEX = 'v0-catalog'

export function getV0CatalogIndexName(): string {
  return process.env.MEILI_INDEX_V0 || V0_CATALOG_INDEX
}
