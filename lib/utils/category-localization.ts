/**
 * Localization utilities for categories
 *
 * These utilities help display category names in the correct language
 * based on the current locale.
 */

import type { part_categories } from '@prisma/client'

type PartCategory = part_categories

/**
 * Get the localized name for a Part category
 */
export function getPartCategoryName(
  category: PartCategory,
  locale: string
): string {
  if (locale === 'tr' && category.name_tr) {
    return category.name_tr
  }
  return category.name
}

/**
 * Generic function to get localized category name
 * Works with any object that has name and name_tr properties
 */
export function getLocalizedCategoryName(
  category: { name: string; name_tr?: string | null; nameTr?: string | null },
  locale: string
): string {
  if (locale === 'tr') {
    if (category.name_tr) return category.name_tr
    if (category.nameTr) return category.nameTr
  }
  return category.name
}

/**
 * Transform a list of categories to include localized names
 */
export function localizeCategoryList<
  T extends { name: string; name_tr?: string | null }
>(categories: T[], locale: string): (T & { localizedName: string })[] {
  return categories.map((category) => ({
    ...category,
    localizedName: getLocalizedCategoryName(category, locale)
  }))
}
