import { ReactNode } from 'react'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import { getMainNavCategories } from '@/lib/mainNavCategories'

interface CategoryLayoutProps {
  children: ReactNode
  params: Promise<{
    locale: string
    slug: string[]
  }>
}

// Default metadata for category pages
export const metadata = {
  title: 'Car Parts | GetirBakim',
  description:
    'Shop for car parts online. Find brake systems, filters, suspension, steering, engine parts and more from top brands.'
}

// Parse vehicle info from URL slug
// Example slug: "alfa-romeo-giulietta-940-1-4-tb-88kw-55650-ci..."
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

  // Try to extract vehicle info from slug
  // Format: make-model-variant-kw-tecdocid
  const parts = slug.split('-')
  if (parts.length < 4) return undefined

  // Basic parsing - this will be refined based on actual URL patterns
  const make = parts[0]?.toUpperCase() || ''
  const model = parts.slice(1, 3).join(' ').toUpperCase() || ''

  // Extract kW info from slug if present
  const kwMatch = slug.match(/(\d+)kw/i)
  const kwValue = kwMatch ? kwMatch[1] : ''
  const psValue = kwValue ? Math.round(parseInt(kwValue) * 1.36) : ''
  const kwPs = kwValue ? `${kwValue}kW/${psValue}PS` : ''

  // Extract fuel type (petrol/diesel) if present
  const fuelMatch = slug.match(/(petrol|diesel|benzin|dizel)/i)
  const fuel = fuelMatch
    ? fuelMatch[1].charAt(0).toUpperCase() + fuelMatch[1].slice(1)
    : ''

  // Get variant info from middle parts
  const variant = parts.slice(3, -2).join(' ').toUpperCase() || ''

  // Extract variant ID (variants.id)
  // Support both -cid and -vtid suffixes
  const variantIdMatch = slug.match(/-(\d+)-(cid|vtid)$/)
  const variantId = variantIdMatch ? parseInt(variantIdMatch[1], 10) : undefined

  return { make, model, variant, fuel, kwPs, variantId }
}

export default async function CategoryLayout({
  children,
  params
}: CategoryLayoutProps) {
  const { locale } = await params

  // Fetch main nav categories from DB (Car parts + 4 main)
  const navbarCategories = await getMainNavCategories(locale)

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Navbar */}
      <Navbar navbarCategories={navbarCategories} />

      {/* Main Content */}
      <main className="flex-1">
        {children}
      </main>

      {/* Footer */}
      <Footer />
    </div>
  )
}
