'use client'

import Link from 'next/link'
import { ArrowLeft, Home, SearchX } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useLocale } from 'next-intl'

type SupportedLocale = 'en' | 'tr'

const COPY: Record<
  SupportedLocale,
  {
    badge: string
    title: string
    description: string
    home: string
    catalog: string
    back: string
  }
> = {
  en: {
    badge: 'Error 404',
    title: 'The page you are looking for is not available',
    description:
      'The link may be outdated, removed, or typed incorrectly. You can continue from home or browse categories.',
    home: 'Go to home',
    catalog: 'Browse categories',
    back: 'Go back'
  },
  tr: {
    badge: 'Hata 404',
    title: 'Aradığınız sayfa bulunamadı',
    description:
      'Bağlantı eski olabilir, kaldırılmış olabilir veya adres hatalı yazılmış olabilir. Ana sayfaya dönebilir ya da kategorilere geçebilirsiniz.',
    home: 'Ana sayfaya git',
    catalog: 'Kategorilere göz at',
    back: 'Geri dön'
  }
}

function normalizeLocale(locale: string): SupportedLocale {
  return locale === 'en' ? 'en' : 'tr'
}

export default function NotFoundPage() {
  const locale = useLocale()
  const safeLocale = normalizeLocale(locale)
  const copy = COPY[safeLocale]

  return (
    <section className="relative overflow-hidden bg-slate-50 px-4 py-16 sm:px-6 sm:py-20">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(30,64,175,0.10),transparent_40%),radial-gradient(circle_at_80%_10%,rgba(15,23,42,0.08),transparent_35%),radial-gradient(circle_at_50%_80%,rgba(148,163,184,0.10),transparent_40%)]"
      />

      <div className="relative mx-auto max-w-3xl">
        <div className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-sm backdrop-blur-sm sm:p-10">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
            <SearchX className="h-3.5 w-3.5" />
            {copy.badge}
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {copy.title}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
            {copy.description}
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={`/${safeLocale}`}
              className={cn(
                buttonVariants({ size: 'lg' }),
                'bg-slate-900 text-white hover:bg-slate-800'
              )}
            >
              <Home className="mr-2 h-4 w-4" />
              {copy.home}
            </Link>

            <Link
              href={`/${safeLocale}/car-parts`}
              className={cn(buttonVariants({ variant: 'outline', size: 'lg' }))}
            >
              {copy.catalog}
            </Link>

            <Link
              href={`/${safeLocale}`}
              className={cn(buttonVariants({ variant: 'ghost', size: 'lg' }))}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              {copy.back}
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
