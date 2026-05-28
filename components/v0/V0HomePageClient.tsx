'use client'

import Link from 'next/link'
import { useLocale } from 'next-intl'
import type { V0HomePageData } from '@/lib/v0/types'
import { SafeImage } from '@/components/ui/SafeImage'

export default function V0HomePageClient({ brands }: V0HomePageData) {
  const locale = useLocale()

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-16 max-w-7xl items-center px-4">
          <Link href={`/${locale}`} className="text-xl font-bold text-foreground">
            GetirBakim
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-semibold text-foreground">
          {locale === 'tr' ? 'Markalar' : 'Brands'}
        </h1>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {brands.map((brand) => (
            <Link
              key={brand.matchId}
              href={`/${locale}/b/${brand.slug}`}
              className="flex flex-col items-center gap-2 rounded-lg border border-border bg-background p-4 transition-colors hover:bg-muted/50"
            >
              <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-muted">
                <SafeImage
                  src={brand.logoUrl || ''}
                  alt={brand.brandName}
                  width={64}
                  height={64}
                  className="h-full w-full object-contain"
                  fallback={<span className="text-lg font-bold text-muted-foreground">{brand.brandName[0]}</span>}
                />
              </div>
              <span className="text-center text-sm font-medium text-foreground">
                {brand.brandName}
              </span>
            </Link>
          ))}
        </div>
      </main>
    </div>
  )
}
