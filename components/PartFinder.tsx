'use client'

import React from 'react'
import { VehicleSelector } from './selector/VehicleSelector'
import { useShop } from './ShopProvider'
import { Star } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { getPublicUrl } from '@/lib/storage/url'

const partFinderBackground = getPublicUrl(
  'partfinder-bg.webp',
  'category-images'
)

export const PartFinder: React.FC = () => {
  const { selectedVehicle } = useShop()
  const t = useTranslations('PartFinder')

  // Format vehicle display string: "MAKE MODEL (CODE) Fuel Engine Power"
  const formatVehicleInfo = () => {
    if (!selectedVehicle) return ''
    const { make, model, engine } = selectedVehicle
    const fuel = (selectedVehicle as any)?.fuel
    return `${make?.toUpperCase() || ''} ${model || ''} ${fuel || ''} ${
      engine || ''
    }`.trim()
  }

  return (
    <div
      className="relative bg-cover bg-center pt-7 pb-6 sm:pt-8 sm:pb-7 isolate z-10"
      style={{ backgroundImage: `url("${partFinderBackground}")` }}
    >
      <div className="absolute inset-0 bg-primary/70 -z-10" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 text-center relative z-10">
        {selectedVehicle ? (
          // Vehicle Selected View
          <>
            {/* Trustpilot Rating */}
            <div className="flex items-center justify-center gap-2 mb-2.5 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <span className="text-primary-foreground text-sm font-medium">
                {t('excellent')}
              </span>
              <div className="flex items-center gap-0.5">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className="w-5 h-5 bg-success flex items-center justify-center"
                  >
                    <Star className="w-3 h-3 text-success-foreground fill-success-foreground" />
                  </div>
                ))}
              </div>
              <Star className="w-4 h-4 text-success fill-success" />
              <span className="text-primary-foreground text-sm">{t('trustpilot')}</span>
            </div>

            {/* Main Title */}
            <h1
              className="text-[30px] sm:text-[38px] font-bold text-primary-foreground tracking-tight 
              mb-2 animate-in fade-in slide-in-from-bottom-6 duration-500 delay-100"
            >
              {t('buySpareParts')}
            </h1>

            {/* Vehicle Info */}
            <p
              className="text-[13px] text-muted-foreground/70 font-medium animate-in 
              fade-in slide-in-from-bottom-8 duration-500 delay-200"
            >
              {formatVehicleInfo()}
            </p>
          </>
        ) : (
          // No Vehicle Selected View
          <>
            {/* Trustpilot Rating */}
            <div className="flex items-center justify-center gap-2 mb-3 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <span className="text-primary-foreground text-sm font-medium">
                {t('excellent')}
              </span>
              <div className="flex items-center gap-0.5">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className="w-5 h-5 bg-success flex items-center justify-center"
                  >
                    <Star className="w-3 h-3 text-success-foreground fill-success-foreground" />
                  </div>
                ))}
              </div>
              <Star className="w-4 h-4 text-success fill-success" />
              <span className="text-primary-foreground text-sm">{t('trustpilot')}</span>
            </div>

            <h1
              className="text-[34px] sm:text-[44px] font-semibold text-primary-foreground tracking-tight 
              mb-2.5 animate-in fade-in slide-in-from-bottom-6 duration-700 delay-100"
            >
              {t('carSparePartsOnline')}
            </h1>

            <p
              className="text-[13px] text-primary-foreground/80 max-w-2xl mx-auto font-normal animate-in 
              fade-in slide-in-from-bottom-8 duration-700 delay-200"
            >
              {t('selectVehicle')}
            </p>

            <div
              id="vehicle-selector"
              className="animate-in fade-in slide-in-from-bottom-10 duration-700 delay-300 mt-3"
            >
              <VehicleSelector />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
