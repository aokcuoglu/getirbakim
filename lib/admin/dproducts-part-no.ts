/** Matches legacy dproducts imports: suffix after first space in stock_code. */
export function deriveDproductsPartNo(stockCode: string): string | null {
  const trimmed = stockCode.trim()
  if (!trimmed) return null

  const spaceIdx = trimmed.indexOf(' ')
  if (spaceIdx > 0) {
    const suffix = trimmed.slice(spaceIdx + 1).trim()
    return suffix.length > 0 ? suffix : trimmed
  }

  return trimmed
}
