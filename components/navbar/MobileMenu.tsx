'use client'

import React from 'react'
import { X, ChevronRight } from 'lucide-react'
import { Link } from '@/lib/navigation'
import { useTranslations } from 'next-intl'
import type { PartCategory } from '@/lib/actions/getPartCategories'
import Image from 'next/image'
import { getCategoryImagePath } from '@/lib/utils/category-image'
import { buildCatalogPath } from '@/lib/catalog-url'

interface MobileMenuProps {
  isOpen: boolean
  onClose: () => void
  categories: PartCategory[]
}

export const MobileMenu: React.FC<MobileMenuProps> = ({
  isOpen,
  onClose,
  categories
}) => {
  const t = useTranslations('Navbar')

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-[100] md:hidden animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Slide-out Menu */}
      <div className="fixed inset-y-0 left-0 w-[85%] max-w-[320px] bg-white z-[101] md:hidden animate-in slide-in-from-left duration-300 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-16 border-b border-slate-100">
          <span className="text-lg font-bold text-slate-900">
            {t('catalog')}
          </span>
          <button
            onClick={onClose}
            className="p-2 -mr-2 text-slate-500 hover:text-slate-700"
          >
            <X size={24} strokeWidth={1.5} />
          </button>
        </div>

        {/* Categories List */}
        <div className="overflow-y-auto h-[calc(100vh-64px)]">
          <ul className="py-2">
            {categories.map((cat) => {
              const imageUrl = getCategoryImagePath(cat.image)
              return (
                <li key={cat.id}>
                  <Link
                    href={buildCatalogPath({ categoryUrlKey: cat.urlKey })}
                    prefetch={false}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors"
                    onClick={onClose}
                  >
                    {imageUrl ? (
                      <div className="w-10 h-10 relative rounded-lg overflow-hidden bg-slate-50 border border-slate-100 shrink-0">
                        <Image
                          src={imageUrl}
                          alt={cat.name}
                          fill
                          className="object-contain p-1"
                          unoptimized
                        />
                      </div>
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-slate-100 shrink-0" />
                    )}
                    <span className="flex-1 text-sm font-medium text-slate-700">
                      {cat.name}
                    </span>
                    <ChevronRight size={18} className="text-slate-400" />
                  </Link>
                </li>
              )
            })}
          </ul>

          {/* Special Offers Link */}
          <div className="border-t border-slate-100 mt-2 pt-2 px-4">
            <Link
              href="/special-offers"
              prefetch={false}
              className="flex items-center gap-2 py-3 text-sm font-medium text-amber-600"
              onClick={onClose}
            >
              <span>🔥</span>
              {t('specialOffers')}
            </Link>
          </div>
        </div>
      </div>
    </>
  )
}
