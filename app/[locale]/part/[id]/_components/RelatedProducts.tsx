'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Package } from 'lucide-react'
import { SafeImage } from '@/components/ui/SafeImage'
import { buildProductDisplayName } from '@/lib/product-display-name'

interface RelatedPart {
  id: number
  name: string
  price: string | null
  stockQty: number
  priceSource: 'real' | 'placeholder'
  isPlaceholderPrice: boolean
  isPurchasable: boolean
  brandName: string
  categoryName?: string | null
  brandLogo: string | null
  thumb: string | null
  image: string | null
  properties: { key: string; value: string }[]
  eans: string[]
  isVehicleSpecific: boolean
  isBestseller: boolean
}

interface RelatedProductsProps {
  parts: RelatedPart[]
  categoryName: string
}

export function RelatedProducts({ parts, categoryName }: RelatedProductsProps) {
  const t = useTranslations('ProductCard')

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 md:p-6">
      <div className="mb-4 md:mb-6">
        <h2 className="text-lg md:text-xl font-bold text-slate-900">
          {categoryName}
        </h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {parts.map((part) => (
          <Link
            key={part.id}
            href={`/part/${part.id}`}
            className="group flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 transition-colors hover:border-slate-300 hover:bg-slate-50/40"
          >
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-100 bg-slate-50">
              {part.thumb || part.image ? (
                <SafeImage
                  src={part.thumb || part.image || ''}
                  alt={part.name}
                  width={56}
                  height={56}
                  className="h-12 w-12 object-contain"
                  fallback={<Package className="h-6 w-6 text-slate-300" />}
                />
              ) : (
                <Package className="h-6 w-6 text-slate-300" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-medium leading-5 text-slate-800 transition-colors group-hover:text-sky-600">
                {buildProductDisplayName({
                  categoryName: part.categoryName ?? categoryName,
                  brandName: part.brandName,
                  name: part.name
                })}
              </p>
            </div>

            <div className="shrink-0 text-right">
              {part.price &&
              part.priceSource === 'real' &&
              !part.isPlaceholderPrice ? (
                <>
                  <p className="text-lg font-bold leading-none text-slate-900">
                    {new Intl.NumberFormat('tr-TR', {
                      style: 'currency',
                      currency: 'TRY',
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2
                    }).format(parseFloat(part.price) * 1.2)}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500 whitespace-nowrap">
                    {t('inclVat')} <span className="mx-1 text-slate-300">|</span>
                    {t('exclShipping')}
                  </p>
                </>
              ) : (
                <p className="text-sm text-slate-500 whitespace-nowrap">
                  {t('priceNotAvailable')}
                </p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
