'use client'

import { useTranslations } from 'next-intl'

interface CategorySeoContentProps {
  categoryName: string
}

export function CategorySeoContent({ categoryName }: CategorySeoContentProps) {
  const t = useTranslations('CategorySeoContent')

  const sections = [
    {
      title: t('sections.buyOnline.title', { categoryName }),
      body: t('sections.buyOnline.body', { categoryName })
    },
    {
      title: t('sections.whyUs.title'),
      body: t('sections.whyUs.body')
    },
    {
      title: t('sections.choosingRightPart.title'),
      body: t('sections.choosingRightPart.body')
    }
  ]

  const faqItems = [
    {
      q: t('faq.items.vehicleFilter.question', { categoryName }),
      a: t('faq.items.vehicleFilter.answer')
    },
    {
      q: t('faq.items.inStock.question'),
      a: t('faq.items.inStock.answer')
    },
    {
      q: t('faq.items.validatePart.question'),
      a: t('faq.items.validatePart.answer')
    }
  ]

  return (
    <section className="bg-white border-t border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-8">
        {sections.map((section) => (
          <div key={section.title}>
            <h2 className="text-xl font-semibold text-slate-900 mb-2">
              {section.title}
            </h2>
            <p className="text-sm leading-7 text-slate-600">{section.body}</p>
          </div>
        ))}

        <div>
          <h2 className="text-xl font-semibold text-slate-900 mb-4">
            {t('faq.title')}
          </h2>
          <div className="space-y-3">
            {faqItems.map((item) => (
              <div key={item.q} className="border border-slate-200 rounded-md p-4">
                <p className="text-sm font-semibold text-slate-900 mb-1">{item.q}</p>
                <p className="text-sm text-slate-600 leading-6">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
