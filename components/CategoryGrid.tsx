'use client'

import { useRouter } from '@/lib/navigation'
import { getCategoryImagePath } from '@/lib/utils/category-image'
import { useRef } from 'react'

interface CategoryGridProps<
  T extends { id: number; name: string; image?: string | null }
> {
  categories: T[]
  onCategoryClick?: (item: T, e?: React.MouseEvent) => void
  getHref?: (item: T) => string
}

export function CategoryGrid<
  T extends { id: number; name: string; image?: string | null }
>({ categories, onCategoryClick, getHref }: CategoryGridProps<T>) {
  const router = useRouter()

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      {categories.map((cat) => {
        const href = getHref?.(cat)
        const Content = (
          <div className="flex flex-col items-center justify-between h-full w-full py-4">
            <div className="flex-1 flex items-center justify-center w-full mb-2">
              <div className="relative w-24 h-24 flex items-center justify-center">
                {getCategoryImagePath(cat.image) ? (
                  <img
                    src={getCategoryImagePath(cat.image)!}
                    alt={cat.name}
                    className="max-h-full max-w-full object-contain hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                  />
                ) : (
                  <span className="text-4xl text-primary-foreground/80">🔧</span>
                )}
              </div>
            </div>
            <h3 className="text-sm font-semibold text-foreground text-center w-full leading-tight">
              {cat.name}
            </h3>
          </div>
        )

        const className =
          'group flex flex-col items-center p-3 bg-background border border-border rounded-lg hover:shadow-md hover:border-input transition-all duration-200 min-h-[140px] cursor-pointer'

        if (href) {
          return (
            <CategoryLink
              key={cat.id}
              href={href}
              className={className}
              onCategoryClick={(e) => onCategoryClick?.(cat, e)}
              router={router}
            >
              {Content}
            </CategoryLink>
          )
        }

        return (
          <button
            key={cat.id}
            onClick={(e) => onCategoryClick?.(cat, e)}
            className={className}
          >
            {Content}
          </button>
        )
      })}
    </div>
  )
}

// Optimized Link component with prefetching
function CategoryLink({
  href,
  className,
  children,
  onCategoryClick,
  router
}: {
  href: string
  className: string
  children: React.ReactNode
  onCategoryClick?: (e: React.MouseEvent) => void
  router: ReturnType<typeof useRouter>
}) {
  const prefetchedRef = useRef(false)

  // Prefetch on hover (instant navigation)
  const handleMouseEnter = () => {
    if (!prefetchedRef.current && href) {
      router.prefetch(href)
      prefetchedRef.current = true
    }
  }

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    onCategoryClick?.(e)
    // Use router.push for instant client-side navigation
    if (!e.defaultPrevented) {
      e.preventDefault()
      router.push(href)
    }
  }

  return (
    <a
      href={href}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      className={className}
    >
      {children}
    </a>
  )
}
