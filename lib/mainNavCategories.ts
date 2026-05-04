/**
 * Main nav categories: re-export from getPartCategories (DB: is_main_nav=true, parent_id IS NULL).
 * Includes "Car parts" (container for other roots) and the 4 main: Lubrication, Filters, Window Cleaning, Accessories.
 */

export { getMainNavCategories } from '@/lib/actions/getPartCategories'
export type { PartCategory as MainNavCategoryItem } from '@/lib/actions/getPartCategories'
