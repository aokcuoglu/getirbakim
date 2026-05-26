import type { SearchHit } from '@/lib/types/search'

export function mapSearchHitToProductCardProps(hit: SearchHit) {
  return {
    id: Number.parseInt(hit.id, 10) || 0,
    name: hit.name,
    sourceType: hit.sourceType,
    supplierProductId: hit.supplierProductId ?? null,
    brandName: hit.brandName,
    brandLogo: hit.brandLogo,
    categoryName: hit.categoryName,
    image: hit.images?.[0]?.image || null,
    thumb: hit.images?.[0]?.thumb || null,
    price: hit.price,
    priceSource: hit.priceSource,
    isPlaceholderPrice: hit.isPlaceholderPrice,
    isPurchasable: hit.isPurchasable,
    properties: [],
    eans: hit.oemCodes || [],
    isVehicleSpecific: false,
    isBestseller: false,
    stock: hit.stockQty,
    availabilityStatus: hit.availabilityStatus,
    cta: hit.cta,
    detailUrl: hit.detailUrl
  }
}
