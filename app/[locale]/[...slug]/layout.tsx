import { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import { getMainNavCategories } from '@/lib/mainNavCategories'
import { getCategoryByUrlKey } from '@/lib/actions/getPartCategories'
import { createTimerGroup } from '@/lib/performance/timing'

interface CategoryLayoutProps {
  children: ReactNode
  params: Promise<{
    locale: string
    slug: string[]
  }>
}

export const metadata = {
  title: 'Car Parts | GetirBakim',
  description:
    'Shop for car parts online. Find brake systems, filters, suspension, steering, engine parts and more from top brands.'
}

export function parseVehicleSlug(slug: string | undefined):
  | {
      make: string
      model: string
      variant: string
      fuel: string
      kwPs: string
      variantId?: number
    }
  | undefined {
  if (!slug) return undefined

  const parts = slug.split('-')
  if (parts.length < 4) return undefined

  const make = parts[0]?.toUpperCase() || ''
  const model = parts.slice(1, 3).join(' ').toUpperCase() || ''

  const kwMatch = slug.match(/(\d+)kw/i)
  const kwValue = kwMatch ? kwMatch[1] : ''
  const psValue = kwValue ? Math.round(parseInt(kwValue) * 1.36) : ''
  const kwPs = kwValue ? `${kwValue}kW/${psValue}PS` : ''

  const fuelMatch = slug.match(/(petrol|diesel|benzin|dizel)/i)
  const fuel = fuelMatch
    ? fuelMatch[1].charAt(0).toUpperCase() + fuelMatch[1].slice(1)
    : ''

  const variant = parts.slice(3, -2).join(' ').toUpperCase() || ''

  const variantIdMatch = slug.match(/-(\d+)-(cid|vtid)$/)
  const variantId = variantIdMatch ? parseInt(variantIdMatch[1], 10) : undefined

  return { make, model, variant, fuel, kwPs, variantId }
}

export default async function CategoryLayout({
  children,
  params
}: CategoryLayoutProps) {
  const { locale, slug } = await params

  const urlKey = slug[0]
  if (!urlKey) {
    notFound()
  }

  const category = await getCategoryByUrlKey(urlKey)
  if (!category?.urlKey) {
    notFound()
  }

  const tg = createTimerGroup('categoryLayout')
  const tNav = tg.start('mainNav')
  const navbarCategories = await getMainNavCategories(locale)
  tg.end(tNav)
  tg.logSummary()

  return (
    <div className="min-h-screen bg-muted flex flex-col">
      <Navbar navbarCategories={navbarCategories} />

      <main className="flex-1">
        {children}
      </main>

      <Footer />
    </div>
  )
}
