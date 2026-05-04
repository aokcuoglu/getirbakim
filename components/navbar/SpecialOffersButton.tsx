'use client'

import React from 'react'
import { useTranslations } from 'next-intl'

interface SpecialOffersButtonProps {
  onClick: () => void
}

export const SpecialOffersButton: React.FC<SpecialOffersButtonProps> = ({
  onClick
}) => {
  const t = useTranslations('Navbar')

  return (
    <button
      onClick={onClick}
      className="whitespace-nowrap text-red-500 hover:text-red-600 transition-colors flex items-center gap-1.5 ml-auto text-[13px] font-medium"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
      {t('specialOffers')}
    </button>
  )
}
