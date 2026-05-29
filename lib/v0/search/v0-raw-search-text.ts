/** Extract searchable plain text from v0.dnmk_product_detail.raw JSON. */
export function extractDproductRawSearchText(raw: unknown): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return ''
  }

  const record = raw as Record<string, unknown>
  const parts: string[] = []

  for (const key of [
    'marka',
    'stokAdi',
    'stokKodu',
    'kull1s',
    'kull3s',
    'kull7s',
    'kull8s',
    'oemListe',
    'esdegerListe',
    'barkod1',
    'barkod2',
    'barkod3',
    'ingilizceAdi'
  ]) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      parts.push(value.trim())
    }
  }

  return parts.join(' ')
}
