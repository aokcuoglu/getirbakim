/**
 * Spec keys that exist in ProductCard.specs.
 * Only these keys should be passed to t('specs.' + key) to avoid missing-message warnings.
 */
export const PRODUCT_SPEC_KEYS = new Set([
  'Construction Year from',
  'Construction Year to',
  'Engine Code',
  'Filter type',
  'Length [mm]',
  'Length 1 [mm]',
  'Length 2 [mm]',
  'Width [mm]',
  'Width 1 [mm]',
  'Width 2 [mm]',
  'Height [mm]',
  'Height 2 [mm]',
  'Quantity',
  'EAN',
  'ID',
  'for OE number',
  'Observe service information'
])

/**
 * Spec values that exist in ProductCard.specValues.
 * Only these values should be passed to t('specValues.' + value) to avoid missing-message warnings.
 */
export const PRODUCT_SPEC_VALUE_KEYS = new Set(['Filter Insert'])
