'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from '@/lib/navigation'
import { buildCatalogPath } from '@/lib/catalog-url'

interface FallbackBreadcrumbProps {
  categoryName: string
  categoryUrlKey?: string | null
  partName: string
}

export function FallbackBreadcrumb({
  categoryName,
  categoryUrlKey,
  partName
}: FallbackBreadcrumbProps) {
  const t = useTranslations('Part')
  const router = useRouter()

  return (
    <div className="bg-white border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-2 md:py-3">
        <nav className="text-xs md:text-sm text-slate-500 flex items-center flex-wrap gap-1">
          <a
            href="/"
            onClick={(event) => {
              event.preventDefault()
              router.push('/')
            }}
            className="hover:text-slate-700 cursor-pointer"
          >
            {t('home')}
          </a>
          <span className="mx-1 md:mx-2">/</span>
          {categoryUrlKey ? (
            <a
              href={buildCatalogPath({
                categoryUrlKey
              })}
              onClick={(event) => {
                event.preventDefault()
                router.push(
                  buildCatalogPath({
                    categoryUrlKey
                  })
                )
              }}
              className="hover:text-slate-700 truncate max-w-[120px] md:max-w-none"
            >
              {categoryName}
            </a>
          ) : (
            <span className="truncate max-w-[120px] md:max-w-none">
              {categoryName}
            </span>
          )}
          <span className="mx-1 md:mx-2">/</span>
          <span className="text-slate-900 font-medium truncate max-w-[150px] md:max-w-none">
            {partName}
          </span>
        </nav>
      </div>
    </div>
  )
}
