'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BrandsTab } from './BrandsTab'
import { ProductsTab } from './ProductsTab'

export function EslestirmeMainClient() {
  return (
    <Tabs defaultValue="brands">
      <TabsList>
        <TabsTrigger value="brands">Markalar</TabsTrigger>
        <TabsTrigger value="products">Ürünler</TabsTrigger>
      </TabsList>
      <TabsContent value="brands">
        <BrandsTab />
      </TabsContent>
      <TabsContent value="products">
        <ProductsTab />
      </TabsContent>
    </Tabs>
  )
}
