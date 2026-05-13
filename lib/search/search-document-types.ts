export type DocumentType = 'canonical_part' | 'supplier_offer' | 'orphan_supplier_product'

export type MatchStatus = 'APPROVED' | 'CANDIDATE' | 'QUEUE' | 'NEEDS_REVIEW' | 'UNMAPPED' | 'MANUAL'

export type SearchDocumentAvailability =
  | 'PURCHASABLE'
  | 'REQUEST_PRICE'
  | 'VERIFY_FITMENT'
  | 'OUT_OF_STOCK'

export interface CanonicalSearchDocument {
  id: string
  documentType: DocumentType
  partId: string | null
  supplierProductId: number | null
  canonicalPartId: string | null
  title: string
  titleTr: string | null
  brand: string | null
  categoryId: number | null
  categoryName: string | null
  categoryNameTr: string | null
  categorySlug: string | null
  supplierSku: string | null
  normalizedSku: string | null
  providerCode: string | null
  providerName: string | null
  oemCodes: string[]
  eanCodes: string[]
  crossReferences: string[]
  referenceNumbers: string[]
  exactCodes: string[]
  normalizedSearchText: string
  searchKeywords: string[]
  synonymsText: string
  price: number | null
  stockQty: number
  currency: string | null
  hasPrice: boolean
  hasStock: boolean
  hasSupplierOffer: boolean
  offerCount: number
  bestOfferProvider: string | null
  bestOfferSupplierProductId: number | null
  availabilityStatus: SearchDocumentAvailability
  cta: string
  matchStatus: MatchStatus
  matchConfidence: number | null
  matchReason: string | null
  vehicleBrandNames: string[]
  vehicleModelNames: string[]
  vehicleTypeNames: string[]
  vehicleYears: string[]
  engineCodes: string[]
  fitmentCount: number
  detailUrl: string | null
  imageUrl: string | null
  updatedAt: number
  rankScore: number
  name: string
  brandName: string | null
  brandId: number | null
  articleLinkId: string
  sourceType: 'part' | 'supplier_product'
}

export const MAX_OEM_CODES = 12
export const MAX_EAN_CODES = 12
export const MAX_CROSS_REFERENCES = 12
export const MAX_REFERENCE_NUMBERS = 6
export const MAX_VEHICLE_FIELDS = 20
export const MAX_ENGINE_CODES = 12
export const MAX_SEARCH_KEYWORDS = 30