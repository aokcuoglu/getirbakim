import type { ReactNode } from 'react'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import type { MainNavCategoryItem } from '@/lib/mainNavCategories'

type PageShellProps = {
  navbarCategories: MainNavCategoryItem[]
  children: ReactNode
  /** Tailwind max-width class for the main container, e.g. "max-w-4xl" or "max-w-6xl". */
  maxWidth?: string
  /** Extra className for <main>. */
  mainClassName?: string
}

/**
 * Standard page wrapper: full-height muted background + Navbar + centered main + Footer.
 *
 * Replaces the repeated layout block across account / orders / checkout / lookup pages:
 *   <div className="min-h-screen bg-muted">
 *     <Navbar navbarCategories={navbarCategories} />
 *     <main className="mx-auto max-w-... px-4 pb-... pt-...">...</main>
 *     <Footer />
 *   </div>
 */
export function PageShell({
  navbarCategories,
  children,
  maxWidth = 'max-w-6xl',
  mainClassName
}: PageShellProps) {
  return (
    <div className="min-h-screen bg-muted">
      <Navbar navbarCategories={navbarCategories} />
      <main className={`mx-auto ${maxWidth} px-4 pb-16 pt-36 ${mainClassName ?? ''}`}>
        {children}
      </main>
      <Footer />
    </div>
  )
}