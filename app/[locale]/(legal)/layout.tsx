import { ReactNode } from 'react'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import { getMainNavCategories } from '@/lib/mainNavCategories'

export default async function LegalLayout({
  children,
  params
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const navbarCategories = await getMainNavCategories(locale)

  return (
    <div className="min-h-screen bg-muted">
      <Navbar navbarCategories={navbarCategories} />
      {children}
      <Footer />
    </div>
  )
}
