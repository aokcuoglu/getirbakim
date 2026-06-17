import { describe, it, expect } from 'bun:test'

function normalizeModel(input: string | null | undefined): string | null {
  if (!input) return null
  const trimmed = input.trim()
  if (trimmed.length === 0) return null
  const result = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return result.length > 0 ? result : null
}

function parseCsvLine(line: string, headers: string[]): Record<string, string> | null {
  if (!line.trim()) return null
  const fields = line.split(';').map(f => f.trim())
  if (fields.length === 0) return null
  const row: Record<string, string> = {}
  for (let i = 0; i < headers.length; i++) {
    row[headers[i]] = fields[i] ?? ''
  }
  return row
}

function buildUpdatePayload(
  row: Record<string, string>,
  normalizeFn: (v: string | null | undefined) => string | null
): { id: number | null; model: string; normalizedModel: string | null; skip: boolean } {
  const id = parseInt(row.id, 10)
  const modelRaw = (row.MODEL ?? '').trim()

  if (isNaN(id)) return { id: null, model: '', normalizedModel: null, skip: true }
  if (!modelRaw) return { id, model: '', normalizedModel: null, skip: true }

  return {
    id,
    model: modelRaw,
    normalizedModel: normalizeFn(modelRaw),
    skip: false,
  }
}

describe('CSV semicolon parsing', () => {
  const headers = ['id', 'product_id', 'MARKA', 'MODEL', 'title']

  it('parses semicolon-delimited line correctly', () => {
    const row = parseCsvLine('123;PT-001;Toyota;YK-400-1311W;Oil Filter', headers)
    expect(row).not.toBeNull()
    expect(row!.id).toBe('123')
    expect(row!.MODEL).toBe('YK-400-1311W')
    expect(row!.title).toBe('Oil Filter')
    expect(row!.MARKA).toBe('Toyota')
  })

  it('parses line with empty MODEL', () => {
    const row = parseCsvLine('456;PT-002;Honda;;Brake Pad', headers)
    expect(row).not.toBeNull()
    expect(row!.MODEL).toBe('')
  })

  it('returns null for empty line', () => {
    expect(parseCsvLine('', headers)).toBeNull()
  })

  it('returns null for whitespace-only line', () => {
    expect(parseCsvLine('   ', headers)).toBeNull()
  })

  it('handles extra empty columns', () => {
    const headersExtra = ['id', 'product_id', 'MARKA', 'MODEL', 'title', 'extra1', 'extra2']
    const row = parseCsvLine('789;PT-003;BMW;25106304x10;Air Filter;;;', headersExtra)
    expect(row).not.toBeNull()
    expect(row!.MODEL).toBe('25106304x10')
  })
})

describe('empty MODEL skipped', () => {
  const normalize = normalizeModel

  it('skips row with empty MODEL', () => {
    const payload = buildUpdatePayload({ id: '1', MODEL: '', title: 'Test' }, normalize)
    expect(payload.skip).toBe(true)
  })

  it('skips row with whitespace-only MODEL', () => {
    const payload = buildUpdatePayload({ id: '1', MODEL: '   ', title: 'Test' }, normalize)
    expect(payload.skip).toBe(true)
  })

  it('skips row with missing MODEL key', () => {
    const payload = buildUpdatePayload({ id: '1', title: 'Test' }, normalize)
    expect(payload.skip).toBe(true)
  })

  it('processes row with valid MODEL', () => {
    const payload = buildUpdatePayload({ id: '1', MODEL: 'YK-400', title: 'Test' }, normalize)
    expect(payload.skip).toBe(false)
    expect(payload.normalizedModel).toBe('YK400')
  })

  it('skips row with invalid id', () => {
    const payload = buildUpdatePayload({ id: 'abc', MODEL: 'YK-400', title: 'Test' }, normalize)
    expect(payload.skip).toBe(true)
  })
})

describe('id-based update payload', () => {
  it('uses CSV id as match key', () => {
    const payload = buildUpdatePayload({ id: '42', MODEL: 'ABC' }, normalizeModel)
    expect(payload.id).toBe(42)
  })

  it('sets model to raw CSV value', () => {
    const payload = buildUpdatePayload({ id: '1', MODEL: 'YK-400-1311W' }, normalizeModel)
    expect(payload.model).toBe('YK-400-1311W')
  })

  it('sets normalizedModel to normalized value', () => {
    const payload = buildUpdatePayload({ id: '1', MODEL: 'YK-400-1311W' }, normalizeModel)
    expect(payload.normalizedModel).toBe('YK4001311W')
  })

  it('preserves exact raw model casing', () => {
    const payload = buildUpdatePayload({ id: '1', MODEL: 'yk4001311w' }, normalizeModel)
    expect(payload.model).toBe('yk4001311w')
    expect(payload.normalizedModel).toBe('YK4001311W')
  })
})

describe('duplicate normalized_model detection', () => {
  it('counts models that normalize to the same value', () => {
    const models = ['YK-400', 'YK 400', 'YK.400', 'YK/400']
    const normalized = models.map(m => normalizeModel(m))
    const unique = new Set(normalized)
    expect(unique.size).toBe(1)
  })

  it('detects different models as distinct', () => {
    const models = ['YK-400', 'AB-500', 'CD-600']
    const normalized = models.map(m => normalizeModel(m))
    const unique = new Set(normalized)
    expect(unique.size).toBe(3)
  })

  it('counts duplicates correctly', () => {
    const rows = [
      { id: 1, MODEL: 'YK-400' },
      { id: 2, MODEL: 'YK 400' },
      { id: 3, MODEL: 'AB-500' },
      { id: 4, MODEL: 'YK.400' },
    ]
    const counts = new Map<string, number>()
    for (const r of rows) {
      const n = normalizeModel(r.MODEL)
      if (n) counts.set(n, (counts.get(n) ?? 0) + 1)
    }
    const duplicateCount = Array.from(counts.values()).filter(c => c > 1).length
    expect(duplicateCount).toBe(1)
    expect(counts.get('YK400')).toBe(3)
  })
})