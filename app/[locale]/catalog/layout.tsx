import { ReactNode } from 'react'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import { getMainNavCategories } from '@/lib/mainNavCategories'

export default async function CatalogLayout({
  children,
  params
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const navbarCategories = await getMainNavCategories(locale)

  return (
    <div className="min-h-screen bg-muted flex flex-col">
      <Navbar navbarCategories={navbarCategories} />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  )
}
