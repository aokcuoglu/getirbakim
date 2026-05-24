'use client'

import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BrandsTab } from './BrandsTab'
import { ProductsTab } from './ProductsTab'

export function EslestirmeMainClient() {
  const [activeTab, setActiveTab] = useState('brands')
  const [mountedTabs, setMountedTabs] = useState<Set<string>>(() => new Set(['brands']))

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
