'use client'

import React from 'react'
import { useLocale } from 'next-intl'
import { useTranslations } from 'next-intl'
import { Link } from '@/lib/navigation'

interface TopUtilityBarProps {
  onContactClick?: () => void
}

const LINKS = [
  { labelKey: 'delivery', href: '/teslimat-ve-iade' },
  { labelKey: 'contact', href: '/iletisim' },
  { labelKey: 'distanceSales', href: '/mesafeli-satis-sozlesmesi' },
  { labelKey: 'privacy', href: '/gizlilik-politikasi' }
]

export const TopUtilityBar: React.FC<TopUtilityBarProps> = ({
  onContactClick
}) => {
  const locale = useLocale()
  const t = useTranslations('TopUtilityBar')

  return (
    <div className="hidden md:block border-b border-slate-100 bg-slate-50">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-8 flex items-center justify-between text-[11px] text-slate-600">
        <div className="flex items-center gap-3">
          {LINKS.map((item) => (
            <Link
              key={item.labelKey}
              href={item.href}
              prefetch={false}
              onClick={onContactClick}
              className="transition-colors hover:text-slate-900"
            >
              {t(item.labelKey)}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-3 text-slate-700">
          <span className="uppercase font-semibold tracking-wide">{locale}</span>
          <span className="text-slate-300">|</span>
          <span className="font-medium">EUR</span>
        </div>
      </div>
    </div>
  )
}
