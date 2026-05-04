'use client'

import React from 'react'
import { Menu } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { CatalogSheet } from '@/components/CatalogSheet'

interface CatalogButtonProps {
  isCatalogOpen: boolean
  setIsCatalogOpen: (open: boolean) => void
  closeDropdowns: () => void
}

export const CatalogButton: React.FC<CatalogButtonProps> = ({
  isCatalogOpen,
  setIsCatalogOpen,
  closeDropdowns
}) => {
  const t = useTranslations('Navbar')

  return (
    <>
      <button
        onClick={() => {
          closeDropdowns()
          setIsCatalogOpen(true)
        }}
        className="flex items-center gap-2.5 pr-5 border-r border-slate-200 h-full text-slate-700 hover:text-blue-600 font-medium transition-colors"
      >
        <Menu size={17} strokeWidth={2} />
        <span className="text-[13px] font-bold uppercase tracking-wide">
          {t('catalog')}
        </span>
      </button>
      <CatalogSheet
        open={isCatalogOpen}
        onOpenChange={setIsCatalogOpen}
      />
    </>
  )
}
