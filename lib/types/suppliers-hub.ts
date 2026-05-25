export type MappingStatusCounts = {
  pending: number
  approved: number
  rejected: number
  ignored: number
  total: number
}

export type SuppliersHubPipelineStep = {
  id: string
  label: string
  description: string
  count: number
  href: string
  status: 'ok' | 'warning' | 'muted' | 'blocked'
}

export type SuppliersHubProviderCard = {
  id: 'dinamik' | 'parcatedarik' | 'basbug'
  name: string
  subtitle: string
  integrationStatus: 'active' | 'partial' | 'planned'
  baseUrl: string | null
  lastSyncAt: string | null
  syncHealth: {
    lastRunStatus: string | null
    failedRate30d: number
    totalRuns30d: number
  } | null
  metrics: Array<{ label: string; value: number; hint?: string }>
  pipeline: SuppliersHubPipelineStep[]
  actions: Array<{
    label: string
    href: string
    variant: 'primary' | 'secondary'
  }>
}

export type SuppliersHubOverview = {
  generatedAt: string
  summary: {
    totalDinamikProducts: number
    unmatchedDinamikBrands: number
    pendingBrandMatches: number
    pendingModelMatches: number
    parcaProducts: number
    parcaBrokenUrls: number
  }
  providers: SuppliersHubProviderCard[]
}

export function formatHubPercent(matched: number, total: number): string {
  if (total <= 0) return '—'
  return `%${Math.round((matched / total) * 100)}`
}
