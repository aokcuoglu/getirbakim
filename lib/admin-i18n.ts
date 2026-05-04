/**
 * Creates a simple translation helper for admin pages.
 * @param locale - The current locale ('tr' or 'en')
 * @returns A function that returns the appropriate translation
 */
export function createAdminTranslator(locale: string) {
  return (en: string, tr: string) => (locale === 'tr' ? tr : en)
}

/**
 * Type for the translator function
 */
export type AdminTranslator = ReturnType<typeof createAdminTranslator>
