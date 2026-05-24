'use client'

import * as React from 'react'
import {
  LayoutDashboard,
  ShoppingBag,
  FolderTree,
  Truck,
  Inbox,
  Link2,
  PanelLeftClose,
  PanelLeftOpen,
  Search
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Link, usePathname } from '@/lib/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface SidebarItemProps {
  icon: React.ElementType
  label: string
  href?: string
  active?: boolean
  collapsed?: boolean
  onNavigate?: () => void
  children?: { label: string; href: string; active: boolean }[]
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

  const itemClassName = cn(
    'group flex cursor-pointer items-center rounded-lg transition-colors duration-150',
    collapsed ? 'justify-center p-2' : 'px-3 py-1.5',
    active
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
  )

  const iconClassName = cn(
    'shrink-0',
    active
      ? 'text-primary-foreground'
      : 'text-muted-foreground group-hover:text-accent-foreground'
  )

  const content = (
    <div className={itemClassName}>
      <Icon size={collapsed ? 16 : 18} className={iconClassName} />
      {!collapsed && (
        <div className="ml-3 flex flex-1 items-center justify-between">
          <span className="text-sm font-medium">{label}</span>
          {hasChildren && (
            <svg
              className={cn(
                'h-4 w-4 transition-transform',
                isExpanded && 'rotate-180'
              )}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          )}
        </div>
      )}
    </div>
  )

  if (href && !hasChildren) {
    return (
      <Link href={href} aria-label={label} title={label} onClick={onNavigate}>
        {content}
      </Link>
    )
  }

  if (hasChildren && !collapsed) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className={cn('group w-full', itemClassName)}
        >
          <Icon size={collapsed ? 16 : 18} className={iconClassName} />
          <div className="ml-3 flex flex-1 items-center justify-between">
            <span className="text-sm font-medium">{label}</span>
            <svg
              className={cn(
                'h-4 w-4 transition-transform',
                isExpanded && 'rotate-180'
              )}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>
        </button>
        {isExpanded && (
          <div className="ml-4 mt-1 space-y-0.5 border-l border-border pl-3">
            {children.map((child) => (
              <Link
                key={child.label}
                href={child.href}
                onClick={onNavigate}
                className={cn(
                  'block rounded-md py-1.5 pl-3 text-sm transition-colors',
                  child.active
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                {child.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    )
  }

  return content
}

interface SidebarProps {
  collapsed?: boolean
  onToggleCollapsed?: () => void
  mobile?: boolean
  onNavigate?: () => void
}

export function Sidebar({
  collapsed = false,
  onToggleCollapsed,
  mobile = false,
  onNavigate
}: SidebarProps) {
  const pathname = usePathname()
  const isCollapsed = mobile ? false : collapsed

  const menuGroups = [
    {
      title: 'Ana Menü',
      items: [
        {
          icon: LayoutDashboard,
          label: 'Ana Sayfa',
          href: '/admin',
          active: pathname === '/admin'
        },
        {
          icon: ShoppingBag,
          label: 'Mağazam',
          active:
            pathname.startsWith('/admin/orders') ||
            pathname.startsWith('/admin/products') ||
            pathname.startsWith('/admin/customers'),
          children: [
            {
              label: 'Ürünler',
              href: '/admin/products',
              active:
                pathname === '/admin/products' ||
                pathname.startsWith('/admin/products/')
            },
            {
              label: 'Siparişler',
              href: '/admin/orders',
              active: pathname.startsWith('/admin/orders')
            },
            {
              label: 'Müşteriler',
              href: '/admin/customers',
              active: pathname.startsWith('/admin/customers')
            }
          ]
        },
        {
          icon: FolderTree,
          label: 'Kategoriler',
          href: '/admin/categories',
          active: pathname.startsWith('/admin/categories')
        },
        {
          icon: Truck,
          label: 'Tedarikçiler',
          href: '/admin/suppliers',
          active: pathname.startsWith('/admin/suppliers')
        },
        {
          icon: Link2,
          label: 'Eşleştirmeler',
          href: '/admin/eslestirme',
          active: pathname.startsWith('/admin/eslestirme')
        },
        {
          icon: Inbox,
          label: 'Talepler',
          href: '/admin/requests',
          active: pathname.startsWith('/admin/requests')
        }
      ]
    }
  ]

  return (
    <div
      className={cn(
        'sidebar-scroll relative z-20 flex h-full flex-col bg-card transition-all duration-300 ease-in-out',
        isCollapsed ? 'w-16' : 'w-[240px]',
        !isCollapsed && 'border-r border-border'
      )}
    >
      {isCollapsed ? (
        <div className="flex flex-col items-center gap-1.5 px-2 py-3">
          <Link
            href="/admin"
            aria-label="Ana Sayfa"
            title="Ana Sayfa"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary"
          >
            <LayoutDashboard className="h-4 w-4 text-primary-foreground" />
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onToggleCollapsed}
            className="h-7 w-7"
            aria-label="Sidebarı genişlet"
            title="Sidebarı genişlet"
          >
            <PanelLeftOpen className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
            <LayoutDashboard className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="flex-1 truncate text-sm font-semibold text-foreground">
            Admin Panel
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onToggleCollapsed}
            className="h-7 w-7"
            aria-label="Sidebarı daralt"
            title="Sidebarı daralt"
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {!isCollapsed && (
        <div className="mb-4 px-4">
          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="text"
              aria-label="Sidebar menü ara"
              placeholder="Ara..."
              className="pl-8"
            />
          </div>
        </div>
      )}

      <div
        className={cn(
          'flex-1 space-y-1 py-2',
          isCollapsed ? 'px-2' : 'px-3 pb-4'
        )}
      >
        {menuGroups.map((group, idx) => (
          <div key={idx} className="space-y-1">
            {!isCollapsed && (
              <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.title}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item, itIdx) => (
                <SidebarItem
                  key={itIdx}
                  {...item}
                  collapsed={isCollapsed}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
