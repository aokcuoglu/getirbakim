'use client'

import { GitCompare, Package } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { SupplierBrandMatchResult } from '@/lib/admin/supplier-brand-shared'
import { BrandMatchTab } from './BrandMatchTab'
import { ProductMatchTab } from './ProductMatchTab'

interface EslestirmeClientProps {
  initialBrandData: SupplierBrandMatchResult
}

export function EslestirmeClient({ initialBrandData }: EslestirmeClientProps) {
  return (
    <Tabs defaultValue="brands" className="w-full">
      <TabsList>
        <TabsTrigger value="brands">
          <GitCompare className="h-4 w-4" />
          Marka Eşleştirme
        </TabsTrigger>
        <TabsTrigger value="products">
          <Package className="h-4 w-4" />
          Ürün Eşleştirme
        </TabsTrigger>
      </TabsList>

      <TabsContent value="brands" className="mt-4">
        <BrandMatchTab initialData={initialBrandData} />
      </TabsContent>

      <TabsContent value="products" className="mt-4">
        <ProductMatchTab />
      </TabsContent>
    </Tabs>
  )
}
