'use client'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { AdminApprovedDpmatchListResult } from '@/lib/admin/approved-dpmatch-catalog'
import type { AdminProductsResult } from '@/lib/types/admin-products'
import { ApprovedDpmatchProductsClient } from './ApprovedDpmatchProductsClient'
import { ProductsAdminClient } from './ProductsAdminClient'

const VALID_TABS = new Set(['catalog', 'approved'])

interface AdminProductsTabsClientProps {
  catalogData: AdminProductsResult
  approvedData: AdminApprovedDpmatchListResult
  initialProductId: string | null
  initialTab: 'catalog' | 'approved'
}

export function AdminProductsTabsClient({
  catalogData,
  approvedData,
  initialProductId,
  initialTab
}: AdminProductsTabsClientProps) {
  const t = useTranslations('AdminCatalog.products')
  const searchParams = useSearchParams()
  const resolvedInitialTab = useMemo(() => {
    const tab = searchParams.get('tab')
    if (tab && VALID_TABS.has(tab)) {
      return tab as 'catalog' | 'approved'
    }
    return initialTab
  }, [initialTab, searchParams])

  const [activeTab, setActiveTab] = useState(resolvedInitialTab)
  const [mountedTabs, setMountedTabs] = useState<Set<string>>(
    () => new Set([resolvedInitialTab])
  )

  const handleTabChange = (value: string) => {
    setActiveTab(value as 'catalog' | 'approved')
    setMountedTabs((prev) => {
      if (prev.has(value)) return prev
      const next = new Set(prev)
      next.add(value)
      return next
    })

    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (value === 'catalog') {
      params.delete('tab')
    } else {
      params.set('tab', value)
    }
    const query = params.toString()
    const url = query
      ? `${window.location.pathname}?${query}`
      : window.location.pathname
    window.history.replaceState(null, '', url)
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="gap-4">
      <TabsList>
        <TabsTrigger value="catalog">{t('tabCatalog')}</TabsTrigger>
        <TabsTrigger value="approved">{t('tabApproved')}</TabsTrigger>
      </TabsList>

      <TabsContent value="catalog" forceMount>
        {mountedTabs.has('catalog') ? (
          <ProductsAdminClient
            data={catalogData}
            initialProductId={initialProductId}
          />
        ) : null}
      </TabsContent>

      <TabsContent value="approved" forceMount>
        {mountedTabs.has('approved') ? (
          <ApprovedDpmatchProductsClient initialData={approvedData} />
        ) : null}
      </TabsContent>
    </Tabs>
  )
}
