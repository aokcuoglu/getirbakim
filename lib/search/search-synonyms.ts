export interface SynonymGroup {
  canonical: string
  terms: string[]
}

export const SYNONYM_GROUPS: SynonymGroup[] = [
  {
    canonical: 'fuel filter',
    terms: ['yakit filtresi', 'mazot filtresi', 'fuel filter', 'fuel-filter', 'yakit-filtresi', 'mazot-filtresi']
  },
  {
    canonical: 'oil filter',
    terms: ['yag filtresi', 'oil filter', 'oil-filter', 'yag-filtresi']
  },
  {
    canonical: 'air filter',
    terms: ['hava filtresi', 'air filter', 'air-filter', 'hava-filtresi']
  },
  {
    canonical: 'cabin filter',
    terms: ['polen filtresi', 'kabin filtresi', 'cabin filter', 'cabin-filter', 'polen-filtresi', 'kabin-filtresi', 'cabin air filter']
  },
  {
    canonical: 'brake pad',
    terms: ['fren balatasi', 'brake pad', 'brake-pad', 'fren-balatasi', 'brake pad set']
  },
  {
    canonical: 'brake disc',
    terms: ['fren diski', 'brake disc', 'brake-disc', 'fren-diski', 'brake rotor']
  },
  {
    canonical: 'clutch',
    terms: ['debriyaj', 'clutch', 'clutch kit', 'debriyaj seti']
  },
  {
    canonical: 'shock absorber',
    terms: ['amortisor', 'shock absorber', 'shock-absorber', 'amortisor']
  },
  {
    canonical: 'spark plug',
    terms: ['buji', 'spark plug', 'spark-plug', 'buji']
  },
  {
    canonical: 'glow plug',
    terms: ['kizdirma bujisi', 'glow plug', 'glow-plug', 'kizdirma-bujisi', 'heated plug']
  },
  {
    canonical: 'belt',
    terms: ['kayis', 'belt', 'kayis', 'v-belt', 'timing belt', 'timing kayis', 'triger kayisi']
  },
  {
    canonical: 'water pump',
    terms: ['su pompasi', 'devirdaim', 'water pump', 'water-pump', 'su-pompasi', 'devirdaim pompasi']
  },
  {
    canonical: 'alternator',
    terms: ['sarj dinamasi', 'alternator', 'sarj dinamasi', 'dinamo']
  },
  {
    canonical: 'starter',
    terms: ['marş motoru', 'starter', 'mars motoru', 'starting motor']
  },
  {
    canonical: 'radiator',
    terms: ['radyator', 'radiator', 'radyator', 'cooling radiator']
  },
  {
    canonical: 'thermostat',
    terms: ['termostat', 'thermostat', 'termostat']
  },
  {
    canonical: 'sensor',
    terms: ['sensor', 'sensor', 'sensing unit', 'o2 sensor', 'lambda sensor', 'lambda probe']
  },
  {
    canonical: 'gasket',
    terms: ['kapak contasi', 'gasket', 'conta', 'kapak contasi', 'head gasket']
  },
  {
    canonical: 'timing belt kit',
    terms: ['triger kayis seti', 'timing belt kit', 'timing-belt-kit', 'triger seti', 'timing chain kit']
  },
  {
    canonical: 'ball joint',
    terms: ['rotil', 'ball joint', 'ball-joint', 'rotil']
  },
  {
    canonical: 'tie rod',
    terms: ['direksiyon rotbasi', 'tie rod', 'tie-rod', 'direksiyon rotbasi', 'rotbasi']
  },
  {
    canonical: 'wheel bearing',
    terms: ['yatak', 'wheel bearing', 'wheel-bearing', 'yatak', 'hub bearing']
  }
]

export function expandSynonyms(query: string): string[] {
  const normalized = query.toLowerCase().trim()
  const expanded: string[] = [normalized]

  for (const group of SYNONYM_GROUPS) {
    const match = group.terms.some(
      (term) => term === normalized || normalized.includes(term) || term.includes(normalized)
    )
    if (match) {
      for (const term of group.terms) {
        if (!expanded.includes(term)) {
          expanded.push(term)
        }
      }
    }
  }

  return expanded
}

export function getSynonymsTextForTerm(term: string): string {
  const normalized = term.toLowerCase().trim()
  const matchedTerms: string[] = []

  for (const group of SYNONYM_GROUPS) {
    if (group.terms.some((t) => t === normalized || normalized.includes(t))) {
      for (const t of group.terms) {
        if (!matchedTerms.includes(t)) {
          matchedTerms.push(t)
        }
      }
    }
  }

  return matchedTerms.join(' ')
}

export function buildSynonymsText(input: {
  categoryName?: string | null
  title?: string | null
}): string {
  const texts: string[] = []

  if (input.categoryName) {
    texts.push(getSynonymsTextForTerm(input.categoryName))
  }
  if (input.title) {
    texts.push(getSynonymsTextForTerm(input.title))
  }

  return texts.filter(Boolean).join(' ')
}

export function getMeiliSynonyms(): Record<string, string[]> {
  const synonyms: Record<string, string[]> = {}

  for (const group of SYNONYM_GROUPS) {
    for (const term of group.terms) {
      if (!synonyms[term]) {
        synonyms[term] = group.terms.filter((t) => t !== term)
      }
    }
  }

  return synonyms
}