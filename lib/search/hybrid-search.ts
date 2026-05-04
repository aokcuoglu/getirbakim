export type HybridTokenBundle = {
  token: string
  alternatives: string[]
}

export type HybridScoreInput = {
  query: string
  partId?: string | number | null
  articleLinkId?: string | number | null
  name?: string | null
  brandName?: string | null
  categoryName?: string | null
  infoContents?: string[]
  oemCodes?: string[]
  eanCodes?: string[]
  crossReferenceCodes?: string[]
  crossReferenceBrands?: string[]
  propertyPairs?: string[]
  vehicleTexts?: string[]
}

export type HybridScore = {
  codeRank: 0 | 1 | 2
  phraseRank: 0 | 1
  tokenMatches: number
}

const MAX_TOKENS = 8
const MIN_TOKEN_LENGTH = 2

function lowerForSearch(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
}

function foldTurkishChar(char: string): string {
  switch (char) {
    case 'ç':
      return 'c'
    case 'ğ':
      return 'g'
    case 'ı':
      return 'i'
    case 'i':
      return 'i'
    case 'ö':
      return 'o'
    case 'ş':
      return 's'
    case 'ü':
      return 'u'
    default:
      return char
  }
}

export function foldTurkishForSearch(value: string): string {
  return lowerForSearch(value)
    .split('')
    .map((char) => foldTurkishChar(char))
    .join('')
}

export function normalizeSearchInput(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ')
}

function sanitizeToken(value: string): string {
  return value
    .replace(/^[^0-9\p{L}]+/gu, '')
    .replace(/[^0-9\p{L}-]+$/gu, '')
}

function toCompactCode(value: string): string {
  return value.replace(/[^0-9a-z]+/g, '')
}

export function buildHybridTokenBundles(query: string): HybridTokenBundle[] {
  const normalized = normalizeSearchInput(query)
  if (!normalized) return []

  const rawTokens = normalized
    .split(/[\s,;|/\\]+/g)
    .map((token) => sanitizeToken(token))
    .map((token) => lowerForSearch(token))
    .filter((token) => token.length >= MIN_TOKEN_LENGTH)

  const uniqueTokens = Array.from(new Set(rawTokens)).slice(0, MAX_TOKENS)

  return uniqueTokens.map((token) => {
    const folded = foldTurkishForSearch(token)
    const compact = toCompactCode(folded)
    const alternatives = new Set<string>([token, folded])

    if (compact.length >= MIN_TOKEN_LENGTH) {
      alternatives.add(compact)
    }

    return {
      token,
      alternatives: Array.from(alternatives)
    }
  })
}

type PhraseVariants = {
  raw: string
  folded: string
  compact: string
}

function buildPhraseVariants(query: string): PhraseVariants | null {
  const normalized = normalizeSearchInput(query)
  if (!normalized) return null

  const raw = lowerForSearch(normalized)
  const folded = foldTurkishForSearch(raw)
  const compact = toCompactCode(folded)

  return { raw, folded, compact }
}

function normalizeValues(values: Array<string | null | undefined>): string[] {
  const out = new Set<string>()

  for (const value of values) {
    if (typeof value !== 'string') continue
    const normalized = normalizeSearchInput(value)
    if (!normalized) continue
    const lowered = lowerForSearch(normalized)
    out.add(lowered)
    out.add(foldTurkishForSearch(lowered))
  }

  return Array.from(out)
}

function buildCodeCandidates(input: HybridScoreInput): string[] {
  const values: Array<string | null | undefined> = [
    input.partId != null ? String(input.partId) : null,
    input.articleLinkId != null ? String(input.articleLinkId) : null,
    ...(input.oemCodes || []),
    ...(input.eanCodes || []),
    ...(input.crossReferenceCodes || [])
  ]
  const normalized = normalizeValues(values)
  const out = new Set<string>()

  for (const value of normalized) {
    out.add(value)
    const compact = toCompactCode(value)
    if (compact.length >= MIN_TOKEN_LENGTH) {
      out.add(compact)
    }
  }

  return Array.from(out)
}

function codeRankForQuery(query: string, input: HybridScoreInput): 0 | 1 | 2 {
  const phrase = buildPhraseVariants(query)
  if (!phrase) return 0

  const candidates = buildCodeCandidates(input)
  const queryForms = [phrase.raw, phrase.folded, phrase.compact].filter(Boolean)

  for (const candidate of candidates) {
    for (const queryForm of queryForms) {
      if (candidate === queryForm) return 2
    }
  }

  for (const candidate of candidates) {
    for (const queryForm of queryForms) {
      if (queryForm.length >= MIN_TOKEN_LENGTH && candidate.startsWith(queryForm)) {
        return 1
      }
    }
  }

  return 0
}

function buildSearchTexts(input: HybridScoreInput): string[] {
  return normalizeValues([
    input.name,
    input.brandName,
    input.categoryName,
    ...(input.infoContents || []),
    ...(input.oemCodes || []),
    ...(input.eanCodes || []),
    ...(input.crossReferenceCodes || []),
    ...(input.crossReferenceBrands || []),
    ...(input.propertyPairs || []),
    ...(input.vehicleTexts || [])
  ])
}

function phraseRankForQuery(query: string, input: HybridScoreInput): 0 | 1 {
  const phrase = buildPhraseVariants(query)
  if (!phrase) return 0

  const texts = buildSearchTexts(input)
  for (const text of texts) {
    if (text.includes(phrase.raw) || text.includes(phrase.folded)) {
      return 1
    }
  }

  return 0
}

export function countTokenMatches(
  query: string,
  input: HybridScoreInput
): number {
  const bundles = buildHybridTokenBundles(query)
  if (bundles.length === 0) return 0

  const texts = buildSearchTexts(input)
  let matchCount = 0

  for (const bundle of bundles) {
    const isBundleMatched = bundle.alternatives.some((alternative) =>
      texts.some((text) => text.includes(alternative))
    )
    if (isBundleMatched) matchCount += 1
  }

  return matchCount
}

export function scoreHybridDocument(input: HybridScoreInput): HybridScore {
  return {
    codeRank: codeRankForQuery(input.query, input),
    phraseRank: phraseRankForQuery(input.query, input),
    tokenMatches: countTokenMatches(input.query, input)
  }
}
