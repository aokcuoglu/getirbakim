'use client'

import React from 'react'
import { Star } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { VehicleSelector } from '@/components/selector/VehicleSelector'

interface VehicleInfo {
  make: string
  model: string
  variant: string
  fuel: string
  kwPs: string
}

interface CategoryHeroProps {
  categoryName: string
  vehicleInfo?: VehicleInfo
}

export function CategoryHero({ categoryName, vehicleInfo }: CategoryHeroProps) {
  const t = useTranslations('CategoryPage')

  // Format vehicle info string like: "ALFA ROMEO GIULIETTA (940_) Petrol 1.4 TB (940FXA1A, 940FXT1A) 88kW/120PS"
  const vehicleString = vehicleInfo
    ? `${vehicleInfo.make.toUpperCase()} ${vehicleInfo.model} ${
        vehicleInfo.fuel
      } ${vehicleInfo.variant} ${vehicleInfo.kwPs}`
    : null

  return (
    <div className="relative bg-[url('https://fbhvayopjuixbyddftbk.supabase.co/storage/v1/object/public/category-images/partfinder-bg.webp')] bg-cover bg-center pt-8 pb-16 isolate">
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-slate-900/60 -z-10" />

      <div className="max-w-7xl mx-auto px-6 text-center relative z-10">
        {/* Trustpilot Badge */}
        <div className="flex items-center justify-center gap-2 mb-4">
          <span className="text-white font-medium text-sm">
            {t('excellent')}
          </span>
          <div className="flex items-center gap-0.5">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="w-5 h-5 bg-emerald-500 flex items-center justify-center"
              >
                <Star className="w-3.5 h-3.5 text-white fill-white" />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1 ml-1">
            <Star className="w-4 h-4 text-emerald-500 fill-emerald-500" />
            <span className="text-white text-sm font-medium">Trustpilot</span>
          </div>
        </div>

        {/* Category Title */}
        <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-2">
          {categoryName}
        </h1>

        {/* Subtitle - Select your vehicle */}
        <p className="text-sm text-slate-200 font-normal mb-4">
          {t('selectVehicle')}
        </p>

        {/* Vehicle Selector */}
        <VehicleSelector />

        {/* Vehicle Info (when selected) */}
        {vehicleString && (
          <p className="text-sm text-slate-200 font-normal max-w-3xl mx-auto mt-4">
            {vehicleString}
          </p>
        )}
      </div>
    </div>
  )
}
