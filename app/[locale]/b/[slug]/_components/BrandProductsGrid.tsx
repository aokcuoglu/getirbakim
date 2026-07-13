'use client'

import { useCallback } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Package } from 'lucide-react'
import type { SearchHit } from '@/lib/types/search'
import { GridProductCard } from '@/app/[locale]/[...slug]/_components/GridProductCard'
import { Pagination } from '@/components/ui/Pagination'
import { CustomerRequestDialog } from '@/components/customer-requests/CustomerRequestDialog'
import { Button } from '@/components/ui/button'

interface BrandProductsGridProps {
  hits: SearchHit[]
  totalHits: number
  page: number
  totalPages: number
  limit: number
  locale: string
  brandName: string
}

function mapHitToProductCardProps(hit: SearchHit) {
  return {
    id: parseInt(hit.id, 10),
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
    isVehicleSpecific: hit.formattedCompatibility.length > 0,
    isBestseller: false,
    stock: hit.stockQty,
    availabilityStatus: hit.availabilityStatus,
    cta: hit.cta,
    detailUrl: hit.detailUrl
  }
}

export function BrandProductsGrid({
  hits,
  totalHits,
  page,
  totalPages,
  limit,
  brandName
}: BrandProductsGridProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const handlePageChange = useCallback(
    (nextPage: number) => {
      const params = new URLSearchParams(searchParams.toString())
      if (nextPage <= 1) {
        params.delete('page')
      } else {
        params.set('page', String(nextPage))
      }
      const query = params.toString()
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: true })
    },
    [router, pathname, searchParams]
  )

  if (hits.length === 0) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center text-center">
        <Package className="h-16 w-16 text-muted-foreground/60" />
        <h3 className="mt-4 text-lg font-medium text-foreground">Sonuç bulunamadı</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Bu markaya ait gösterilecek ürün bulunamadı.
        </p>
        <CustomerRequestDialog
          requestType="MISSING_PRODUCT"
          source="MISSING_PRODUCT_MODAL"
          searchQuery={brandName}
          trigger={
            <Button className="mt-4 bg-success text-success-foreground hover:bg-success/90">
              Ürünü bulamadım
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {hits.map((hit, index) => (
          <GridProductCard
            key={hit.id}
            isFirst={index === 0}
            {...mapHitToProductCardProps(hit)}
          />
        ))}
      </div>

      {totalPages > 1 ? (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          totalItems={totalHits}
          itemsPerPage={limit}
          onPageChange={handlePageChange}
        />
      ) : null}
    </div>
  )
}
