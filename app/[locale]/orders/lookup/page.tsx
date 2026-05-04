import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import { getMainNavCategories } from '@/lib/mainNavCategories'
import { GuestOrderLookupClient } from './GuestOrderLookupClient'
import { getTranslations } from 'next-intl/server'

export default async function GuestOrderLookupPage(props: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await props.params
  const navbarCategories = await getMainNavCategories(locale)
  const t = await getTranslations({ locale, namespace: 'GuestOrderLookupPage' })

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar navbarCategories={navbarCategories} />
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-36">
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
            {t('eyebrow')}
          </p>
          <h1 className="mt-3 text-3xl font-bold text-slate-950">{t('title')}</h1>
          <p className="mt-2 text-sm text-slate-600">
            {t('description')}
          </p>
        </div>

        <GuestOrderLookupClient />
      </main>
      <Footer />
    </div>
  )
}
