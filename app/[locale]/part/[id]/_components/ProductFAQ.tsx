'use client'

import { useTranslations } from 'next-intl'

interface ProductFAQProps {
  partId: number
  productName: string
  brandName: string
  categoryName: string
}

export function ProductFAQ(_props: ProductFAQProps) {
  const t = useTranslations('ProductFAQ')

  return (
    <div className="mt-6 rounded-lg border border-border bg-background p-4 md:p-6">
      <h3 className="mb-3 text-base font-semibold text-foreground">{t('questions')}</h3>
      <p className="text-sm text-muted-foreground">{t('contactInfo')}</p>
    </div>
  )
}
