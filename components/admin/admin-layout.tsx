'use client'

import * as React from 'react'
import { Sidebar } from './sidebar'
import { Home, ChevronRight, User, Menu, LogOut } from 'lucide-react'
import { Link, usePathname, useRouter } from '@/lib/navigation'
import { createClient } from '@/lib/supabase/client'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { useShop } from '@/components/ShopProvider'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription
} from '@/components/ui/sheet'

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, setUser } = useShop()
  const [isMobileNavOpen, setIsMobileNavOpen] = React.useState(false)
  const [isDesktopCollapsed, setIsDesktopCollapsed] = React.useState(false)
  const [isProfileMenuOpen, setIsProfileMenuOpen] = React.useState(false)
  const profileMenuRef = React.useRef<HTMLDivElement | null>(null)
  const segments = pathname
    .split('/')
    .filter(Boolean)
    .filter((segment) => segment !== 'tr' && segment !== 'en')

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
    setIsProfileMenuOpen(false)
  }, [pathname])

  React.useEffect(() => {
    const coreRoutes = [
      '/admin',
      '/admin/products',
      '/admin/orders',
      '/admin/customers',
      '/admin/requests',
      '/admin/suppliers'
    ]
    coreRoutes.forEach((route) => router.prefetch(route))
  }, [router])

  React.useEffect(() => {
    if (!isProfileMenuOpen) return

    const onClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (!profileMenuRef.current?.contains(target)) {
        setIsProfileMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', onClickOutside)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
    }
  }, [isProfileMenuOpen])

  const handleSignOut = React.useCallback(async () => {
    setIsProfileMenuOpen(false)
    setUser(null)
    const supabase = createClient()
    const { error } = await supabase.auth.signOut()
    if (error) {
      console.error('Failed to sign out:', error)
    }
    router.push('/')
    router.refresh()
  }, [router, setUser])

  const labelMap: Record<string, string> = {
    admin: 'Panel',
    products: 'Ürünler',
    tools: 'Araçlar',
    orders: 'Siparişler',
    customers: 'Müşteriler',
    requests: 'Talepler',
    categories: 'Kategoriler',
    new: 'Yeni',
    edit: 'Düzenle'
  }

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 overflow-hidden">
      <div className="hidden md:block shrink-0">
        <Sidebar
          collapsed={isDesktopCollapsed}
          onToggleCollapsed={() => setIsDesktopCollapsed((prev) => !prev)}
        />
      </div>

      <Sheet open={isMobileNavOpen} onOpenChange={setIsMobileNavOpen}>
        <SheetContent
          side="left"
          className="w-[min(86vw,320px)] border-r border-slate-200 p-0 md:hidden"
          hideDefaultClose={false}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Admin navigasyon menüsü</SheetTitle>
            <SheetDescription>
              Admin sayfaları arasında gezinmek için menü.
            </SheetDescription>
          </SheetHeader>
          <Sidebar mobile onNavigate={() => setIsMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-5 lg:px-6">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => setIsMobileNavOpen(true)}
              className="inline-flex items-center justify-center rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 md:hidden"
              aria-label="Admin menüyü aç"
            >
              <Menu size={18} />
            </button>

            <div className="min-w-0 overflow-x-auto scrollbar-hide [-ms-overflow-style:none] [scrollbar-width:none]">
              <div className="flex items-center gap-1 whitespace-nowrap">
                <Link
                  href="/admin"
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Admin ana sayfa"
                >
                  <Home size={16} />
                </Link>
                {segments.map((segment, idx) => (
                  <div key={idx} className="flex items-center gap-1 min-w-0">
                    <ChevronRight size={14} className="shrink-0 text-slate-400" />
                    <span
                      className={cn(
                        'truncate rounded px-1.5 py-0.5 text-sm font-medium max-w-[120px] sm:max-w-[180px]',
                        idx === segments.length - 1
                          ? 'text-slate-900'
                          : 'text-slate-500'
                      )}
                    >
                      {labelMap[segment] || segment}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            <NotificationBell
              buttonClassName="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              iconClassName="relative flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              panelClassName="absolute right-0 top-full z-[120] mt-2 w-[min(92vw,340px)] rounded-lg bg-white shadow-lg ring-1 ring-slate-900/5"
            />
            <div className="mx-1 hidden h-5 w-px bg-slate-200 sm:mx-2 sm:block" />
            <div className="relative" ref={profileMenuRef}>
              <button
                type="button"
                onClick={() => setIsProfileMenuOpen((prev) => !prev)}
                className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
                aria-label="Profil menüsü"
              >
                <User size={16} />
              </button>

              {isProfileMenuOpen && (
                <div className="absolute right-0 top-full z-[130] mt-2 w-56 rounded-lg bg-white p-1.5 shadow-lg ring-1 ring-slate-900/5">
                  <div className="border-b border-slate-100 px-3 py-2">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {user?.name || 'Admin Kullanıcı'}
                    </p>
                    <p className="truncate text-xs text-slate-500">{user?.email || '-'}</p>
                  </div>

                  <Link
                    href="/account"
                    className="mt-1 block rounded-md px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                    onClick={() => setIsProfileMenuOpen(false)}
                  >
                    Hesabım
                  </Link>

                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="mt-0.5 flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50"
                  >
                    <LogOut size={14} />
                    Çıkış Yap
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 lg:p-6 scrollbar-hide">
          {children}
        </div>
      </main>
    </div>
  )
}

function cn(...classes: any[]) {
  return classes.filter(Boolean).join(' ')
}
