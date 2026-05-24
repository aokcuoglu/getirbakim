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
import {
  AdminCard,
  AdminCardContent,
  AdminCardHeader,
  AdminCardTitle
} from '@/components/admin/admin-card'
import { Button } from '@/components/ui/button'

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
    <AdminCard>
      <AdminCardHeader>
        <AdminCardTitle>Hızlı Erişim</AdminCardTitle>
      </AdminCardHeader>
      <AdminCardContent>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {quickActions.map((action) => {
            const Icon = action.icon
            return (
              <Button
                key={action.label}
                variant="outline"
                size="sm"
                className="h-auto flex-col gap-1.5 py-3"
                asChild
              >
                <Link href={action.href}>
                  <Icon className="h-4 w-4" />
                  <span className="text-xs">{action.label}</span>
                </Link>
              </Button>
            )
          })}
        </div>
      </AdminCardContent>
    </AdminCard>
  )
}
