export type DpprdMappingStatus = 'PENDING' | 'APPROVED' | 'IGNORED'
export type DpprdMatchMethod = 'PART_NO_EXACT' | 'MANUAL' | 'BULK'

export interface DpprdMatchFilters {
  q?: string
  status?: 'all' | DpprdMappingStatus
  brandListId?: number | 'all'
  page?: number
  limit?: number
}

export interface DpprdMatchListItem {
  id: string
  brandListId: number
  brandListName: string | null
  dnmkProductId: string
  dnmkStockCode: string
  dnmkStockName: string | null
  dnmkPartNo: string | null
  dnmkBrand: string | null
  dnmkOemNo: string | null
  ptdrkProductId: number
  ptdrkPartNo: string | null
  ptdrkTitle: string
  ptdrkBrand: string | null
  ptdrkRefNo: string | null
  mappingStatus: DpprdMappingStatus
  matchMethod: DpprdMatchMethod | null
  confidence: number | null
  oemNo: string | null
  approvedAt: string | null
  ignoredAt: string | null
  createdAt: string
  updatedAt: string
}

export interface DpprdMatchOverview {
  total: number
  pending: number
  approved: number
  ignored: number
  oemWritten: number
}

export interface DpprdMatchBrandOption {
  id: number
  name: string
  pairCount: number
}

export interface DpprdMatchListResult {
  filters: Required<Omit<DpprdMatchFilters, 'q'>> & { q: string }
  matches: DpprdMatchListItem[]
  pagination: {
    page: number
    limit: number
    total: number
    pages: number
  }
}

export interface DpprdMatchOverviewResult extends DpprdMatchOverview {
  brands: DpprdMatchBrandOption[]
}

export interface DpprdManualSearchCandidate {
  id: number
  partNo: string | null
  title: string
  refNo: string | null
  brandName: string | null
  ptdrkBrandsId: number
  previewOemNo: string | null
}

export interface DpprdManualLinkInput {
  dnmkProductId: string
  ptdrkProductId: number
  matchMethod?: DpprdMatchMethod
}