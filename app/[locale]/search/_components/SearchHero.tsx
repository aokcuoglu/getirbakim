'use client'

import React from 'react'
import { Star, Search } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { VehicleSelector } from '@/components/selector/VehicleSelector'
import { useSearchParams } from 'next/navigation'

export function SearchHero() {
  const t = useTranslations('CategoryPage')
  const searchParams = useSearchParams()
  const query = searchParams.get('q') || ''

  return (
    <div className="relative bg-[url('https://fbhvayopjuixbyddftbk.supabase.co/storage/v1/object/public/category-images/partfinder-bg.webp')] bg-cover bg-center pt-8 pb-16 isolate">
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-primary/60 -z-10" />

      <div className="max-w-7xl mx-auto px-6 text-center relative z-10">
        {/* Trustpilot Badge */}
        <div className="flex items-center justify-center gap-2 mb-4">
          <span className="text-primary-foreground font-medium text-sm">
            {t('excellent')}
          </span>
          <div className="flex items-center gap-0.5">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="w-5 h-5 bg-success flex items-center justify-center"
              >
                <Star className="w-3.5 h-3.5 text-success-foreground fill-success-foreground" />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1 ml-1">
            <Star className="w-4 h-4 text-success fill-success" />
            <span className="text-primary-foreground text-sm font-medium">Trustpilot</span>
          </div>
        </div>

        {/* Title */}
        <h1 className="text-3xl sm:text-4xl font-bold text-primary-foreground tracking-tight mb-2">
          {query ? `"${query}" için sonuçlar` : 'Parça Ara'}
        </h1>

        {/* Subtitle */}
        <p className="text-sm text-primary-foreground/80 font-normal mb-4">
          {t('selectVehicle')}
        </p>

        {/* Vehicle Selector */}
        <VehicleSelector />
      </div>
    </div>
  )
}
