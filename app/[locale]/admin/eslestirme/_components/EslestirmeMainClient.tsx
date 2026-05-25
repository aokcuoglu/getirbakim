'use client'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BrandsTab } from './BrandsTab'
import { ProductsTab } from './ProductsTab'

const VALID_TABS = new Set(['brands', 'products'])

export function EslestirmeMainClient() {
  const searchParams = useSearchParams()
  const initialTab = useMemo(() => {
    const tab = searchParams.get('tab')
    return tab && VALID_TABS.has(tab) ? tab : 'brands'
  }, [searchParams])

  const [activeTab, setActiveTab] = useState(initialTab)
  const [mountedTabs, setMountedTabs] = useState<Set<string>>(() => new Set([initialTab]))

  const handleTabChange = (value: string) => {
    setActiveTab(value)
    setMountedTabs((prev) => {
      if (prev.has(value)) return prev
      const next = new Set(prev)
      next.add(value)
      return next
    })
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="gap-4">
      <TabsList>
        <TabsTrigger value="brands">Markalar</TabsTrigger>
        <TabsTrigger value="products">Ürünler</TabsTrigger>
      </TabsList>
      <TabsContent value="brands" forceMount>
        <BrandsTab />
      </TabsContent>
      <TabsContent value="products" forceMount>
        {mountedTabs.has('products') ? <ProductsTab /> : null}
      </TabsContent>
    </Tabs>
  )
}
