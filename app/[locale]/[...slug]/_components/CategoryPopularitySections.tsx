'use client'

import { useRouter } from '@/lib/navigation'
import { PopularMakes } from '@/components/hero/PopularMakes'
import { PopularManufacturers } from '@/components/hero/PopularManufacturers'
import type { PopularManufacturer } from '@/lib/actions/getPopularManufacturers'
import { buildCatalogPath } from '@/lib/catalog-url'

interface CategoryPopularitySectionsProps {
  manufacturers: PopularManufacturer[]
}

export function CategoryPopularitySections({
  manufacturers
}: CategoryPopularitySectionsProps) {
  const router = useRouter()

  return (
    <>
      <PopularMakes
        onMakeSelect={(make) => {
          router.push(
            buildCatalogPath({
              categoryUrlKey: 'car-parts',
              searchParams: { make }
            })
          )
        }}
      />
      <PopularManufacturers
        manufacturers={manufacturers}
        onBrandSelect={(brand) => {
          router.push(
            buildCatalogPath({
              categoryUrlKey: 'car-parts',
              searchParams: { brand }
            })
          )
        }}
      />
    </>
  )
}
