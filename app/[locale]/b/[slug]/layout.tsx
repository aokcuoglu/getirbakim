import { ReactNode } from 'react'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import { getMainNavCategories } from '@/lib/mainNavCategories'

interface BrandLayoutProps {
  children: ReactNode
  params: Promise<{
    locale: string
    slug: string
  }>
}

export default async function BrandLayout({
  children,
  params
}: BrandLayoutProps) {
  const { locale } = await params
  const navbarCategories = await getMainNavCategories(locale)

  return (
    <div className="min-h-screen text-foreground selection:bg-accent/20 flex flex-col">
      <Navbar navbarCategories={navbarCategories} />
      <main className="flex-1 pb-16">
        {children}
      </main>
      <Footer />
    </div>
  )
}
