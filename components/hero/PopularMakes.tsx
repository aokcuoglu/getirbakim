'use client'
import React from 'react'
import { ArrowRight } from 'lucide-react'
import { POPULAR_MAKES } from './data'
import { useTranslations } from 'next-intl'
import { SafeImage } from '@/components/ui/SafeImage'

interface PopularMakesProps {
  onMakeSelect?: (make: string) => void
}

export function PopularMakes({ onMakeSelect }: PopularMakesProps) {
  const t = useTranslations('Hero')

  return (
    <section className="bg-white py-12 border-t border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 text-center sm:text-left">
        <h2 className="mb-4 text-2xl font-semibold text-slate-900 sm:text-[28px]">
          {t('popularMakes')}
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
          {POPULAR_MAKES.map((make) => (
            <button
              key={make.key}
              onClick={() => onMakeSelect && onMakeSelect(make.key)}
              className="group h-[70px] border border-slate-200 bg-white px-2 transition-colors hover:border-slate-300 hover:bg-slate-50"
              aria-label={make.label}
            >
              <SafeImage
                src={make.logo}
                alt={make.alt}
                width={96}
                height={40}
                className="mx-auto h-10 w-auto object-contain opacity-90 transition-opacity group-hover:opacity-100"
                unoptimized
              />
            </button>
          ))}
          <button className="h-[70px] border border-slate-200 hover:border-slate-300 text-slate-500 hover:text-slate-900 transition-colors flex items-center justify-center text-xs font-semibold bg-transparent">
            {t('allMakes')} <ArrowRight size={12} className="ml-1" />
          </button>
        </div>
      </div>
    </section>
  )
}
