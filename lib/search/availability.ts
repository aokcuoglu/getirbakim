export type AvailabilityStatus =
  | 'PURCHASABLE'
  | 'REQUEST_PRICE'
  | 'VERIFY_FITMENT'
  | 'OUT_OF_STOCK'

export type SearchCTA =
  | 'add_to_cart'
  | 'request_price'
  | 'verify_fitment'
  | 'notify_or_request_price'

export type AvailabilityInput = {
  hasRealPrice: boolean
  availableStock: number
  hasSupplierOffer: boolean
  hasPartId: boolean
}

export function resolveAvailabilityStatus(
  input: AvailabilityInput
): AvailabilityStatus {
  if (input.hasRealPrice && input.availableStock > 0) {
    return 'PURCHASABLE'
  }

  if (input.hasRealPrice && input.availableStock <= 0) {
    return 'OUT_OF_STOCK'
  }

  return 'REQUEST_PRICE'
}

export function resolveCTA(status: AvailabilityStatus): SearchCTA {
  switch (status) {
    case 'PURCHASABLE':
      return 'add_to_cart'
    case 'REQUEST_PRICE':
      return 'request_price'
    case 'VERIFY_FITMENT':
      return 'verify_fitment'
    case 'OUT_OF_STOCK':
      return 'notify_or_request_price'
  }
}

export const AVAILABILITY_CTA_LABELS: Record<
  AvailabilityStatus,
  { tr: string; en: string }
> = {
  PURCHASABLE: { tr: 'Sepete Ekle', en: 'Add to Cart' },
  REQUEST_PRICE: { tr: 'Fiyat Al', en: 'Request Price' },
  VERIFY_FITMENT: { tr: 'Uygunluk Sor', en: 'Verify Fitment' },
  OUT_OF_STOCK: { tr: 'Stok Gelince Haber Ver', en: 'Notify When Available' }
}

export function resolveDetailUrl(input: {
  partId?: string | null
  supplierProductId?: number | null
}): string | null {
  if (input.partId) return `/part/${input.partId}`
  if (input.supplierProductId) return `/supplier-product/${input.supplierProductId}`
  return null
}