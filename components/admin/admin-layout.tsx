'use client'

import * as React from 'react'
import { Sidebar } from './sidebar'
import { Home, ChevronRight, User, Menu, LogOut } from 'lucide-react'
import { Link, usePathname, useRouter } from '@/lib/navigation'
import { createClient } from '@/lib/supabase/client'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { useShop } from '@/components/ShopProvider'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription
} from '@/components/ui/sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, setUser } = useShop()
  const [isMobileNavOpen, setIsMobileNavOpen] = React.useState(false)
  const [isDesktopCollapsed, setIsDesktopCollapsed] = React.useState(false)
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

  const handleSignOut = React.useCallback(async () => {
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
    edit: 'Düzenle',
    eslestirme: 'Eşleştirmeler',
    suppliers: 'Tedarikçiler'
  }

  return (
    <div className="fixed inset-0 z-40 flex overflow-hidden bg-background text-foreground">
      <div className="hidden shrink-0 md:block">
        <Sidebar
          collapsed={isDesktopCollapsed}
          onToggleCollapsed={() => setIsDesktopCollapsed((prev) => !prev)}
        />
      </div>

      <Sheet open={isMobileNavOpen} onOpenChange={setIsMobileNavOpen}>
        <SheetContent
          side="left"
          className="w-[min(86vw,320px)] border-r border-border p-0 md:hidden"
          showCloseButton
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
        <header className="flex h-14 items-center justify-between border-b border-border bg-card/80 px-4 backdrop-blur-sm sm:px-5 lg:px-6">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setIsMobileNavOpen(true)}
              className="md:hidden"
              aria-label="Admin menüyü aç"
            >
              <Menu className="h-4 w-4" />
            </Button>

            <div className="min-w-0 overflow-x-auto scrollbar-hide [-ms-overflow-style:none] [scrollbar-width:none]">
              <div className="flex items-center gap-1 whitespace-nowrap">
                <Link
                  href="/admin"
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  aria-label="Admin ana sayfa"
                >
                  <Home size={16} />
                </Link>
                {segments.map((segment, idx) => (
                  <div key={idx} className="flex min-w-0 items-center gap-1">
                    <ChevronRight
                      size={14}
                      className="shrink-0 text-muted-foreground/70"
                    />
                    <span
                      className={cn(
                        'max-w-[120px] truncate rounded px-1.5 py-0.5 text-sm font-medium sm:max-w-[180px]',
                        idx === segments.length - 1
                          ? 'text-foreground'
                          : 'text-muted-foreground'
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
              buttonClassName="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              iconClassName="relative flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              panelClassName="absolute right-0 top-full z-[120] mt-2 w-[min(92vw,340px)] rounded-md border border-border bg-popover text-popover-foreground shadow-md"
            />
            <div className="mx-1 hidden h-5 w-px bg-border sm:mx-2 sm:block" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Profil menüsü"
                >
                  <User className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="truncate text-sm font-medium">
                      {user?.name || 'Admin Kullanıcı'}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {user?.email || '-'}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/account">Hesabım</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={handleSignOut}
                  className="cursor-pointer"
                >
                  <LogOut className="h-4 w-4" />
                  Çıkış Yap
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-4 scrollbar-hide sm:p-5 lg:p-6">
          {children}
        </div>
      </main>
    </div>
  )
}
