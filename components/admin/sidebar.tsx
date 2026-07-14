'use client'

import * as React from 'react'
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  FolderTree,
  Inbox,
  Settings,
  ChevronDown,
  LogOut,
  User,
  Truck,
  GitCompare,
  ChevronsUpDown,
  Tags,
  Boxes
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Link, usePathname } from '@/lib/navigation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip'
import { AnimatePresence, motion } from 'framer-motion'

interface NavChild {
  label: string
  href: string
  active: boolean
}

interface SidebarItemProps {
  icon: React.ElementType
  label: string
  href?: string
  active?: boolean
  collapsed?: boolean
  onNavigate?: () => void
  children?: NavChild[]
}

function SidebarNavLink({
  icon: Icon,
  label,
  href,
  active,
  collapsed,
  onNavigate
}: {
  icon: React.ElementType
  label: string
  href: string
  active?: boolean
  collapsed?: boolean
  onNavigate?: () => void
}) {
  const link = (
    <Link
      href={href}
      aria-label={label}
      title={collapsed ? label : undefined}
      onClick={onNavigate}
      className={cn(
        'group flex items-center rounded-md text-sm font-medium transition-colors',
        collapsed ? 'justify-center p-2' : 'gap-3 px-3 py-2',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
      )}
    >
      <Icon
        size={16}
        className={cn(
          'shrink-0',
          active ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'
        )}
        strokeWidth={1.75}
      />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  )

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    )
  }

  return link
}

const SidebarItem = ({
  icon: Icon,
  label,
  href,
  active,
  collapsed,
  onNavigate,
  children
}: SidebarItemProps) => {
  const [isExpanded, setIsExpanded] = React.useState(false)
  const hasChildren = children && children.length > 0

  React.useEffect(() => {
    if (hasChildren && children?.some((child) => child.active)) {
      setIsExpanded(true)
    }
  }, [children, hasChildren])

  if (hasChildren && collapsed) {
    return (
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={label}
                className={cn(
                  'group flex w-full items-center justify-center rounded-md p-2 transition-colors',
                  active
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
                )}
              >
                <Icon size={16} strokeWidth={1.75} />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent side="right" align="start" className="min-w-48">
          <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
            {label}
          </p>
          {children.map((child) => (
            <DropdownMenuItem key={child.href} asChild>
              <Link
                href={child.href}
                onClick={onNavigate}
                className={cn('cursor-pointer', child.active && 'font-medium')}
              >
                {child.label}
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  if (href && !hasChildren) {
    return (
      <SidebarNavLink
        icon={Icon}
        label={label}
        href={href}
        active={active}
        collapsed={collapsed}
        onNavigate={onNavigate}
      />
    )
  }

  if (hasChildren && !collapsed) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className={cn(
            'group flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors',
            active
              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
              : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
          )}
        >
          <Icon
            size={16}
            className={cn(
              'shrink-0',
              active ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'
            )}
            strokeWidth={1.75}
          />
          <span className="flex-1 truncate">{label}</span>
          <motion.span
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="flex shrink-0 items-center text-muted-foreground"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </motion.span>
        </button>
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.ul
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
              className="mx-3.5 mt-0.5 flex min-w-0 translate-x-px flex-col gap-0.5 overflow-hidden border-l border-sidebar-border px-2.5 py-0.5">
            {children.map((child) => (
              <li key={child.href}>
                <Link
                  href={child.href}
                  onClick={onNavigate}
                  className={cn(
                    'flex h-8 items-center rounded-md px-2 text-sm transition-colors',
                    child.active
                      ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                      : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
                  )}
                >
                  {child.label}
                </Link>
              </li>
            ))}
          </motion.ul>
          )}
        </AnimatePresence>
      </div>
    )
  }

  return null
}

interface SidebarUser {
  name?: string | null
  email?: string | null
}

interface SidebarProps {
  collapsed?: boolean
  mobile?: boolean
  onNavigate?: () => void
  user?: SidebarUser | null
  onSignOut?: () => void
}

function UserInitials({ name }: { name?: string | null }) {
  const initials = (name || 'A')
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-foreground">
      {initials}
    </div>
  )
}

function TeamSwitcher({ collapsed }: { collapsed?: boolean }) {
  if (collapsed) {
    return (
      <Link
        href="/admin"
        aria-label="GetirBakım"
        className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg border border-sidebar-border bg-background"
      >
        <span className="text-xs font-bold text-foreground">GB</span>
      </Link>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md p-2 text-left transition-colors hover:bg-sidebar-accent"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-sidebar-border bg-background">
            <span className="text-xs font-bold text-foreground">GB</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-none">GetirBakım</p>
            <p className="truncate text-xs text-muted-foreground">Yönetim Paneli</p>
          </div>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem asChild>
          <Link href="/admin" className="cursor-pointer gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md border bg-background text-[10px] font-bold">
              GB
            </div>
            GetirBakım
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Sidebar({
  collapsed = false,
  mobile = false,
  onNavigate,
  user,
  onSignOut
}: SidebarProps) {
  const pathname = usePathname()
  const isCollapsed = mobile ? false : collapsed

  const menuGroups = [
    {
      title: 'Genel',
      items: [
        {
          icon: LayoutDashboard,
          label: 'Genel Bakış',
          href: '/admin',
          active: pathname === '/admin'
        }
      ]
    },
    {
      title: 'Katalog & Satış',
      items: [
        {
          icon: Boxes,
          label: 'Katalog Ürünleri',
          href: '/admin/catalog/products',
          active:
            pathname === '/admin/catalog/products' ||
            pathname.startsWith('/admin/catalog/')
        },
        {
          icon: Package,
          label: 'Ürünler',
          href: '/admin/products',
          active:
            pathname === '/admin/products' ||
            pathname.startsWith('/admin/products/')
        },
        {
          icon: Tags,
          label: 'Markalar',
          href: '/admin/brands',
          active: pathname.startsWith('/admin/brands')
        },
        {
          icon: ShoppingCart,
          label: 'Siparişler',
          href: '/admin/orders',
          active: pathname.startsWith('/admin/orders')
        },
        {
          icon: Users,
          label: 'Müşteriler',
          href: '/admin/customers',
          active: pathname.startsWith('/admin/customers')
        },
        {
          icon: FolderTree,
          label: 'Kategoriler',
          href: '/admin/categories',
          active: pathname.startsWith('/admin/categories')
        },
        {
          icon: Inbox,
          label: 'Talepler',
          href: '/admin/requests',
          active: pathname.startsWith('/admin/requests')
        }
      ]
    },
    {
      title: 'Tedarik & Eşleştirme',
      items: [
        {
          icon: Truck,
          label: 'Tedarikçiler',
          active: pathname.startsWith('/admin/suppliers'),
          children: [
            {
              label: 'Merkez',
              href: '/admin/suppliers',
              active: pathname === '/admin/suppliers'
            },
            {
              label: 'Dinamik',
              href: '/admin/suppliers/dinamik',
              active: pathname.startsWith('/admin/suppliers/dinamik')
            }
          ]
        },
        {
          icon: GitCompare,
          label: 'Eşleştirme',
          href: '/admin/eslestirme',
          active: pathname.startsWith('/admin/eslestirme')
        }
      ]
    },
    {
      title: 'Hesap',
      items: [
        {
          icon: Settings,
          label: 'Hesabım',
          href: '/account',
          active: pathname.startsWith('/account')
        }
      ]
    }
  ]

  return (
    <TooltipProvider delayDuration={0}>
      <div
        className={cn(
          'sidebar-scroll relative z-20 flex h-full flex-col bg-sidebar transition-[width] duration-200 ease-linear',
          isCollapsed ? 'w-[var(--admin-sidebar-width-icon)]' : 'w-[var(--admin-sidebar-width)]',
          !isCollapsed && 'border-r border-sidebar-border'
        )}
      >
        <div className={cn('shrink-0', isCollapsed ? 'px-2 py-3' : 'p-2')}>
          <TeamSwitcher collapsed={isCollapsed} />
        </div>

        <div
          className={cn(
            'flex-1 space-y-4 overflow-y-auto py-2',
            isCollapsed ? 'px-2' : 'px-2'
          )}
        >
          {menuGroups.map((group, idx) => (
            <div key={idx} className="space-y-1">
              {!isCollapsed && (
                <p className="px-2 text-xs font-medium text-muted-foreground">
                  {group.title}
                </p>
              )}
              <nav className="flex flex-col gap-0.5">
                {group.items.map((item, itIdx) => (
                  <SidebarItem
                    key={itIdx}
                    {...item}
                    collapsed={isCollapsed}
                    onNavigate={onNavigate}
                  />
                ))}
              </nav>
            </div>
          ))}
        </div>

        {!isCollapsed && (
          <div className="mt-auto border-t border-sidebar-border p-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md p-2 text-left transition-colors hover:bg-sidebar-accent"
                >
                  <UserInitials name={user?.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {user?.name || 'Yönetici'}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {user?.email || 'Admin paneli'}
                    </p>
                  </div>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-56">
                <DropdownMenuItem asChild>
                  <Link href="/account" className="cursor-pointer">
                    <User className="mr-2 h-4 w-4" />
                    Hesabım
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onSignOut}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Çıkış Yap
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
