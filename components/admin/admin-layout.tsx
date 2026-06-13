'use client'

import * as React from 'react'
import { Sidebar } from './sidebar'
import { AdminHeader } from './admin-header'
import { usePathname, useRouter } from '@/lib/navigation'
import { signOut } from 'next-auth/react'
import { useShop } from '@/components/ShopProvider'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription
} from '@/components/ui/sheet'
import { TooltipProvider } from '@/components/ui/tooltip'

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, setUser } = useShop()
  const [isMobileNavOpen, setIsMobileNavOpen] = React.useState(false)
  const [isDesktopCollapsed, setIsDesktopCollapsed] = React.useState(false)

  React.useEffect(() => {
    const savedValue = window.localStorage.getItem('admin.sidebar.collapsed')
    if (savedValue == null) return
    setIsDesktopCollapsed(savedValue === '1')
  }, [])

  React.useEffect(() => {
    window.localStorage.setItem(
      'admin.sidebar.collapsed',
      isDesktopCollapsed ? '1' : '0'
    )
  }, [isDesktopCollapsed])

  React.useEffect(() => {
    setIsMobileNavOpen(false)
  }, [pathname])

  React.useEffect(() => {
    const coreRoutes = [
      '/admin',
      '/admin/products',
      '/admin/brands',
      '/admin/orders',
      '/admin/customers',
      '/admin/categories',
      '/admin/requests',
      '/admin/suppliers',
      '/admin/eslestirme'
    ]
    coreRoutes.forEach((route) => router.prefetch(route))
  }, [router])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === 'b' &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault()
        if (window.matchMedia('(max-width: 767px)').matches) {
          setIsMobileNavOpen((open) => !open)
        } else {
          setIsDesktopCollapsed((prev) => !prev)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleSignOut = React.useCallback(async () => {
    setUser(null)
    await signOut({ redirect: false })
    router.push('/')
    router.refresh()
  }, [router, setUser])

  const toggleSidebar = React.useCallback(() => {
    if (window.matchMedia('(max-width: 767px)').matches) {
      setIsMobileNavOpen((open) => !open)
      return
    }
    setIsDesktopCollapsed((prev) => !prev)
  }, [])

  return (
    <div className="admin-panel fixed inset-0 z-40 flex overflow-hidden bg-muted/40 text-foreground">
      <div className="hidden shrink-0 md:block">
        <Sidebar
          collapsed={isDesktopCollapsed}
          user={user}
          onSignOut={handleSignOut}
        />
      </div>

      <Sheet open={isMobileNavOpen} onOpenChange={setIsMobileNavOpen}>
        <SheetContent
          side="left"
          className="w-[min(86vw,var(--admin-sidebar-width))] border-r border-sidebar-border bg-sidebar p-0 md:hidden"
          showCloseButton
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Admin navigasyon menüsü</SheetTitle>
            <SheetDescription>
              Admin sayfaları arasında gezinmek için menü.
            </SheetDescription>
          </SheetHeader>
          <Sidebar
            mobile
            onNavigate={() => setIsMobileNavOpen(false)}
            user={user}
            onSignOut={handleSignOut}
          />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background md:my-2 md:mr-2 md:rounded-xl md:border md:border-border/60 md:shadow-sm">
        <AdminHeader onToggleSidebar={toggleSidebar} />

        <div
          data-admin-scroll
          className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-4 scrollbar-hide sm:p-6"
        >
          <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        </div>
      </div>
    </div>
  )
}
