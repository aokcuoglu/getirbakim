import 'server-only'

export type DbrandsMatchPtBrandColumn = 'ptdrk_brands_id' | 'manufacturer_id'

/**
 * Returns the canonical PT brand FK column name for the new mappings schema.
 * The canonical brands table (brand_list) no longer holds FKs;
 * brand_mappings always uses ptdrk_brands_id.
 */
export async function getDbrandsMatchPtBrandColumn(): Promise<DbrandsMatchPtBrandColumn> {
  return 'ptdrk_brands_id'
}
