'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import { SoonNavTrigger } from '@/components/ui/SoonFeature'

interface SpecialOffersButtonProps {
  onClick: () => void
  comingSoon?: boolean
}

export const SpecialOffersButton: React.FC<SpecialOffersButtonProps> = ({
  onClick,
  comingSoon = false
}) => {
  const t = useTranslations('Navbar')

  const label = (
    <>
      <span className="w-1.5 h-1.5 rounded-full bg-destructive/100 animate-pulse" />
      {t('specialOffers')}
    </>
  )

  if (comingSoon) {
    return (
      <SoonNavTrigger className="whitespace-nowrap text-destructive/70 flex items-center gap-1.5 ml-auto text-[13px] font-medium">
        {label}
      </SoonNavTrigger>
    )
  }

  return (
    <button
      onClick={onClick}
      className="whitespace-nowrap text-destructive hover:text-destructive transition-colors flex items-center gap-1.5 ml-auto text-[13px] font-medium"
    >
      {label}
    </button>
  )
}
