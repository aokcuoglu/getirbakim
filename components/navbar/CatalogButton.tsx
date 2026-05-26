'use client'

import React from 'react'
import { Menu } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { CatalogSheet } from '@/components/CatalogSheet'
import { SoonNavTrigger } from '@/components/ui/SoonFeature'

interface CatalogButtonProps {
  isCatalogOpen: boolean
  setIsCatalogOpen: (open: boolean) => void
  closeDropdowns: () => void
  comingSoon?: boolean
}

export const CatalogButton: React.FC<CatalogButtonProps> = ({
  isCatalogOpen,
  setIsCatalogOpen,
  closeDropdowns,
  comingSoon = false
}) => {
  const t = useTranslations('Navbar')

  const label = (
    <>
      <Menu size={17} strokeWidth={2} aria-hidden />
      <span className="text-[13px] font-bold uppercase tracking-wide">
        {t('catalog')}
      </span>
    </>
  )

  if (comingSoon) {
    return (
      <>
        <SoonNavTrigger
          className="flex items-center gap-2.5 pr-5 border-r border-border h-full font-medium"
          onTrigger={() => {
            closeDropdowns()
            setIsCatalogOpen(true)
          }}
        >
          {label}
        </SoonNavTrigger>
        <CatalogSheet
          open={isCatalogOpen}
          onOpenChange={setIsCatalogOpen}
          comingSoon
        />
      </>
    )
  }

  return (
    <>
      <button
        onClick={() => {
          closeDropdowns()
          setIsCatalogOpen(true)
        }}
        className="flex items-center gap-2.5 pr-5 border-r border-border h-full text-foreground hover:text-primary font-medium transition-colors"
      >
        {label}
      </button>
      <CatalogSheet
        open={isCatalogOpen}
        onOpenChange={setIsCatalogOpen}
        comingSoon={comingSoon}
      />
    </>
  )
}
