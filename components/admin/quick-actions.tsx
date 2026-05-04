'use client'

import { Link } from '@/lib/navigation'
import {
  Plus,
  Package,
  ShoppingCart,
  Users,
  FolderTree,
  Truck,
  RefreshCw,
  Search
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface QuickAction {
  icon: React.ElementType
  label: string
  href: string
}

const quickActions: QuickAction[] = [
  {
    icon: Plus,
    label: 'Yeni Ürün',
    href: '/admin/products/new'
  },
  {
    icon: Package,
    label: 'Ürünler',
    href: '/admin/products'
  },
  {
    icon: ShoppingCart,
    label: 'Siparişler',
    href: '/admin/orders'
  },
  {
    icon: Users,
    label: 'Müşteriler',
    href: '/admin/customers'
  },
  {
    icon: FolderTree,
    label: 'Kategoriler',
    href: '/admin/categories'
  },
  {
    icon: Truck,
    label: 'Tedarikçiler',
    href: '/admin/suppliers'
  },
  {
    icon: RefreshCw,
    label: 'Senkronizasyon',
    href: '/admin/suppliers/mappings'
  },
  {
    icon: Search,
    label: 'Ara',
    href: '/admin/products'
  }
]

export function QuickActions() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="text-sm font-semibold text-slate-900 mb-4">Hızlı Erişim</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {quickActions.map((action) => {
          const Icon = action.icon
          return (
            <Link
              key={action.label}
              href={action.href}
              className="group flex flex-col items-center gap-2 rounded-lg p-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 transition-colors group-hover:bg-slate-200">
                <Icon size={18} />
              </div>
              <span className="text-xs">{action.label}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
