'use client'

import { SafeImage } from '@/components/ui/SafeImage'
import { getCategoryImagePath } from '@/lib/utils/category-image'
import { useLocale } from 'next-intl'
import { useRef } from 'react'
import Link from 'next/link'
import { useShop } from '@/components/ShopProvider'
import { buildCatalogUrl } from '@/lib/catalog-url'
import { useRouter } from 'next/navigation'

/**
 * Converts category image from database to display path
 */
function getImagePath(image: string | null): string {
  const normalized = getCategoryImagePath(image)
  if (!normalized) return '/img/placeholder.webp'
  return normalized
}

export interface TopCategoryItem {
  id: number
  name: string
  urlKey: string
  image: string | null
}

interface TopCategoriesProps {
  categories: TopCategoryItem[]
  onCategoryClick: (cat: TopCategoryItem) => void
}

export function TopCategories({
  categories,
  onCategoryClick
}: TopCategoriesProps) {
  const locale = useLocale()
  const router = useRouter()
  const { selectedVehicle } = useShop()
  const selectedVehicleUrlKey = selectedVehicle?.urlKey ?? null
  const prefetchedHrefsRef = useRef<Set<string>>(new Set())

  const getCategoryLabel = (name: string) => {
    const normalized = name.toLocaleLowerCase(locale === 'tr' ? 'tr-TR' : 'en-US')
    const isWiperEquipment =
      (normalized.includes('silecek') || normalized.includes('wiper')) &&
      (normalized.includes('ekipman') || normalized.includes('equipment'))

    if (isWiperEquipment) {
      return locale === 'tr' ? 'Silecekler' : 'Wipers'
    }

    return name
  }

  return (
    <div className="border-b border-border relative z-0 bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
        <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1 sm:mx-0 sm:px-0 sm:overflow-visible sm:flex-wrap sm:justify-between sm:gap-3">
          {categories.map((cat) => {
            const imagePath = getImagePath(cat.image)
            const href = buildCatalogUrl(locale, {
              categoryUrlKey: cat.urlKey,
              variantSlug: selectedVehicleUrlKey
            })

            return (
              <Link
                key={cat.id}
                href={href}
                prefetch={false}
                onClick={(event) => {
                  event.preventDefault()
                  onCategoryClick(cat)
                }}
                onMouseEnter={() => {
                  if (prefetchedHrefsRef.current.has(href)) return
                  prefetchedHrefsRef.current.add(href)
                  router.prefetch(href)
                }}
                onTouchStart={() => {
                  if (prefetchedHrefsRef.current.has(href)) return
                  prefetchedHrefsRef.current.add(href)
                  router.prefetch(href)
                }}
                className="group flex w-[94px] shrink-0 cursor-pointer flex-col items-center gap-1.5 px-1 py-1 sm:w-auto sm:min-w-[84px] sm:flex-1"
              >
                <div className="relative flex h-[46px] w-full items-center justify-center sm:h-[62px]">
                  <SafeImage
                    src={imagePath}
                    alt={getCategoryLabel(cat.name)}
                    width={100}
                    height={100}
                    sizes="(max-width: 640px) 96px, 120px"
                    className="h-full w-auto max-w-full object-contain"
                    style={{ width: 'auto', height: '100%' }}
                  />
                </div>
                <span
                  className="line-clamp-2 min-h-[32px] border-b border-transparent text-center text-[14px] font-medium leading-4 text-foreground transition-colors group-hover:border-input group-hover:text-primary"
                >
                  {getCategoryLabel(cat.name)}
                </span>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
