import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Normalize a part number for consistent searching and comparison
 * Removes special characters, normalizes whitespace, and handles brand-specific patterns
 */
export function normalizePartNumber(
  partNumber: string,
  options?: { brand?: string; productName?: string }
): string {
  if (!partNumber) return ''

  // Convert to uppercase and trim
  let normalized = partNumber.toUpperCase().trim()

  // Remove common separators and special characters
  normalized = normalized.replace(/[-_.\s\/\\]+/g, '')

  // Remove common prefixes that might be inconsistent
  normalized = normalized.replace(/^(PN|PART|NO|NUM|#)+/i, '')

  return normalized
}

/**
 * Parse a Prisma Decimal to a number with specified decimal places
 */
export function parseDecimalToNumber(
  value: { toString(): string } | number | string | null | undefined,
  decimalPlaces: number = 2
): number | undefined {
  if (value === null || value === undefined) {
    return undefined
  }

  let numValue: number

  if (typeof value === 'number') {
    numValue = value
  } else if (typeof value === 'string') {
    numValue = parseFloat(value)
  } else {
    // Handle Prisma Decimal
    numValue = Number(value)
  }

  if (isNaN(numValue)) {
    return undefined
  }

  return Number(numValue.toFixed(decimalPlaces))
}

export function formatCurrency(
  value: number | string | null | undefined,
  currency: string = 'TRY',
  locale: string = 'tr-TR'
): string {
  if (value == null || Number.isNaN(value)) return '-'
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (!Number.isFinite(num)) return '-'
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(num)
}
