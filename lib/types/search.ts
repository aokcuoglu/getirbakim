/**
 * Search Types
 *
 * TypeScript interfaces for faceted search functionality.
 */

// ============================================================================
// URL & Filter Types
// ============================================================================

/** Sort option for search */
export type SearchSort = 'popularity' | 'price-asc' | 'price-desc' | 'name'

/** Parsed filters from URL search params */
export interface SearchFilters {
  /** Search query */
  query: string
  /** Selected vehicle slug from URL (`variant`) */
  variant?: string
  /** Selected brand names (comma-separated in URL) */
  brands: string[]
  /** Selected category names */
  categories: string[]
  /** Price range */
  minPrice?: number
  maxPrice?: number
  /** Sort order */
  sort?: SearchSort
  /** Pagination */
  page: number
  limit: number
}

/** URL parameter keys */
export const SEARCH_PARAM_KEYS = {
  QUERY: 'q',
  VARIANT: 'variant',
  BRANDS: 'brands',
  CATEGORIES: 'categories',
  MIN_PRICE: 'minPrice',
  MAX_PRICE: 'maxPrice',
  SORT: 'sort',
  PAGE: 'page'
} as const

// ============================================================================
// Meilisearch Response Types
// ============================================================================

/** Facet distribution from Meilisearch */
export type FacetDistribution = Record<string, Record<string, number>>

/** Single search hit from Meilisearch (matches sync script output) */
export interface SearchHit {
  id: string
  name: string
  articleLinkId: string
  dedupeKey?: string
  variantCount?: number
  price: string | null
  stockQty: number
  priceSource: 'real' | 'placeholder'
  isPlaceholderPrice: boolean
  isPurchasable: boolean
  inBasket: boolean
  brandId: number
  brandName: string
  brandLogo: string | null
  categoryId: number
  categoryName: string | null
  categoryNameTr: string | null
  oemCodes: string[]
  oemBrands: string[]
  vehicleTypes: string[]
  vehicleIds: number[]
  vehicleNames: string[]
  formattedCompatibility: string[]
  searchableText: string
  images: { image: string | null; thumb: string | null }[]
  properties: {
    key: string
    value: string
    key_tr?: string | null
    value_tr?: string | null
  }[]
  createdAt: string
  updatedAt: string
  sourceType?: 'part' | 'supplier_product'
  resolvedPartId?: string
  supplierProductId?: number | null
  providerCode?: string | null
  supplierSku?: string | null
  matchType?: 'approved_oem_mapping' | 'manual_mapping' | 'derived_clone'
  canonicalKey?: string
  rankBucket?: number
  /** Meilisearch highlight info */
  _formatted?: Partial<SearchHit>
  /** Availability status from catalog+offer search */
  availabilityStatus?: 'PURCHASABLE' | 'REQUEST_PRICE' | 'VERIFY_FITMENT' | 'OUT_OF_STOCK'
  /** Call-to-action from catalog+offer search */
  cta?: 'add_to_cart' | 'request_price' | 'verify_fitment' | 'notify_or_request_price'
  /** Detail URL from catalog+offer search */
  detailUrl?: string | null
}

// ============================================================================
// Facet Types
// ============================================================================

/** Single facet option with count */
export interface FacetOption {
  /** Facet value (e.g., brand ID as string) */
  value: string
  /** Display label (e.g., "Bosch") */
  label: string
  /** Number of matching documents */
  count: number
  /** Is this option currently selected */
  isSelected: boolean
}

/** Facet group (e.g., "Brands", "Categories") */
export interface FacetGroup {
  /** Facet field name */
  field: string
  /** Display name */
  label: string
  /** Available options */
  options: FacetOption[]
}

// ============================================================================
// Hook Return Type
// ============================================================================

/** Return type for useSearch hook */
export interface UseSearchResult {
  /** Current filters */
  filters: SearchFilters
  /** Search results */
  hits: SearchHit[]
  /** Total number of results */
  totalHits: number
  /** Facet groups for sidebar */
  facets: FacetGroup[]
  /** Loading state */
  isLoading: boolean
  /** Error state */
  error: Error | null
  /** Update a single filter */
  setFilter: <K extends keyof SearchFilters>(
    key: K,
    value: SearchFilters[K]
  ) => void
  /** Toggle a facet value (for multi-select) */
  toggleFacet: (field: string, value: string) => void
  /** Clear all filters */
  clearFilters: () => void
  /** Set search query */
  setQuery: (query: string) => void
}

// ============================================================================
// Brand/Category Label Maps (for display)
// ============================================================================

/** Brand ID to name mapping (will be populated from first search) */
export type BrandLabelMap = Map<number, string>

/** Category ID to name mapping */
export type CategoryLabelMap = Map<number, string>
