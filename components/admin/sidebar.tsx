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
    if (hasChildren && children?.some(child => child.active)) {
      setIsExpanded(true)
    }
  }, [children, hasChildren])

  const content = (
    <div
      className={cn(
        'group flex cursor-pointer items-center rounded-lg transition-all duration-150',
        collapsed ? 'justify-center p-[9px]' : 'px-3 py-2',
        active
          ? 'bg-slate-900 text-white'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      )}
    >
      <Icon
        size={18}
        className={cn(
          'shrink-0',
          active ? 'text-white' : 'text-slate-500 group-hover:text-slate-700'
        )}
      />
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
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
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
          className={cn(
            'group flex w-full cursor-pointer items-center rounded-lg px-3 py-2 transition-all duration-150',
            active
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          )}
        >
          <Icon
            size={18}
            className={cn(
              'shrink-0',
              active ? 'text-white' : 'text-slate-500 group-hover:text-slate-700'
            )}
          />
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
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>
        {isExpanded && (
          <div className="ml-4 mt-1 space-y-0.5 border-l border-slate-200 pl-3">
            {children.map((child) => (
              <Link
                key={child.label}
                href={child.href}
                onClick={onNavigate}
                className={cn(
                  'block rounded-md py-1.5 pl-3 text-sm transition-colors',
                  child.active
                    ? 'font-medium text-slate-900'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
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
              active: pathname === '/admin/products' || pathname.startsWith('/admin/products/')
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
        'relative z-20 flex h-full flex-col bg-white transition-all duration-300 ease-in-out',
        isCollapsed ? 'w-[72px]' : 'w-[260px]',
        !isCollapsed && 'border-r border-slate-200'
      )}
    >
      <div
        className={cn(
          'flex items-center gap-3 px-3 py-4',
          isCollapsed && 'justify-center px-0'
        )}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900">
          <LayoutDashboard className="h-5 w-5 text-white" />
        </div>
        {!isCollapsed && (
          <>
            <span className="flex-1 truncate text-base font-semibold text-slate-900">
              Admin Panel
            </span>
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="flex h-7 w-7 items-center justify-center rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Sidebarı daralt"
              title="Sidebarı daralt"
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        {isCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="flex h-7 w-7 items-center justify-center rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Sidebarı genişlet"
            title="Sidebarı genişlet"
          >
            <PanelLeftOpen className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {!isCollapsed && (
        <div className="mb-4 px-4">
          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
              size={14}
            />
            <input
              type="text"
              aria-label="Sidebar menü ara"
              placeholder="Ara..."
              className="w-full rounded-md border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-300"
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
              <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {group.title}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item: any, itIdx) => (
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
