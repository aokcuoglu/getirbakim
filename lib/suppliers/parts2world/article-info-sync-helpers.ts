export type ArticleInfoPartRow = {
  id: bigint
}

function normalizeText(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text.length > 0 ? text : null
}

export function normalizePartPropertyRows(
  source: Record<string, unknown> | undefined
): Array<{ key: string; value: string }> {
  if (!source || typeof source !== 'object') return []

  const dedupe = new Map<string, { key: string; value: string }>()

  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = normalizeText(rawKey)
    const value = normalizeText(rawValue)
    if (!key || !value) continue

    const signature = `${key.toLocaleLowerCase('tr')}::${value.toLocaleLowerCase('tr')}`
    if (!dedupe.has(signature)) {
      dedupe.set(signature, { key, value })
    }
  }

  return Array.from(dedupe.values())
}

export function normalizeInfoRowsWithSpareInfo(
  infoRows: unknown[] | undefined,
  spareInfo: unknown
): string[] {
  const dedupe = new Set<string>()

  for (const item of infoRows || []) {
    const normalized = normalizeText(item)
    if (!normalized) continue
    dedupe.add(normalized)
  }

  const normalizedSpareInfo = normalizeText(spareInfo)
  if (normalizedSpareInfo) {
    dedupe.add(normalizedSpareInfo)
  }

  return Array.from(dedupe)
}

export function buildPrioritizedQueue<T extends ArticleInfoPartRow>(
  seedRows: T[],
  backlogRows: T[]
): T[] {
  const seen = new Set<string>()
  const queue: T[] = []

  for (const row of seedRows) {
    const key = row.id.toString()
    if (seen.has(key)) continue
    seen.add(key)
    queue.push(row)
  }

  for (const row of backlogRows) {
    const key = row.id.toString()
    if (seen.has(key)) continue
    seen.add(key)
    queue.push(row)
  }

  return queue
}
