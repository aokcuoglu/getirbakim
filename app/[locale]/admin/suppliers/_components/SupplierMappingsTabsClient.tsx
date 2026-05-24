'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { SupplierProductMappingRow } from '@/lib/types/admin-products'
import { BrandMappingsClient } from './BrandMappingsClient'
import { SupplierMappingsClient } from './SupplierMappingsClient'

interface ProductTabListResult {
  success: boolean
  message: string | null
  providerCode: string
  provider: { id: number; code: string; name: string } | null
  providers: Array<{ code: string; name: string }>
  rows: SupplierProductMappingRow[]
  pagination: {
    page: number
    limit: number
    total: number
    pages: number
  }
  filters: {
    providerCode: string
    q: string
    queryBrand: string | null
    matchState: 'all' | 'matched' | 'unmatched'
    mappingStatus: 'all' | 'approved' | 'ignored' | 'candidate' | 'unmatched'
  }
  currentQuery: string
  currentBrand: string
  currentMatchState: 'all' | 'matched' | 'unmatched'
  currentMappingStatus: 'all' | 'approved' | 'ignored' | 'candidate' | 'unmatched'
}

interface SupplierMappingsTabsClientProps {
  initialTab: 'brands' | 'products'
  productTab: {
    initialLoaded: boolean
    initialData: ProductTabListResult | null
    initialSummary: { total: number; matched: number; unmatched: number } | null
    initialFilters: {
      providerCode: string
      q: string
      brand: string
      matchState: 'all' | 'matched' | 'unmatched'
      status: 'all' | 'approved' | 'ignored' | 'candidate' | 'unmatched'
      page: number
      limit: number
    }
  }
  brandTab: {
    enabled: boolean
    initialLoaded: boolean
    initialRows: Array<{
      supplierBrand: string
      mappedPartBrand: { id: number; name: string } | null
      exactCandidate: { id: number; name: string } | null
      status: 'APPROVED' | 'PENDING' | 'UNMAPPED'
      confidence: number | null
      updatedAt: string | null
    }>
    initialPagination: {
      page: number
      limit: number
      total: number
      pages: number
    }
    initialSummary: {
      total: number
      mapped: number
      pending: number
      unmapped: number
    }
    initialFilters: {
      q: string
      status: 'all' | 'mapped' | 'unmapped' | 'pending'
    }
  }
}

export function SupplierMappingsTabsClient({
  initialTab,
  productTab,
  brandTab
}: SupplierMappingsTabsClientProps) {
  return (
    <Tabs defaultValue={initialTab} className="gap-4">
      <TabsList>
        <TabsTrigger value="brands">Markalar</TabsTrigger>
        <TabsTrigger value="products">Ürünler</TabsTrigger>
      </TabsList>

      <TabsContent value="brands">
        {brandTab.enabled ? (
          <BrandMappingsClient
            initialLoaded={brandTab.initialLoaded}
            initialRows={brandTab.initialRows}
            initialPagination={brandTab.initialPagination}
            initialSummary={brandTab.initialSummary}
            initialFilters={brandTab.initialFilters}
          />
        ) : (
          <div className="rounded-xl border border-warning/20 bg-warning/10 p-4 text-sm text-warning">
            Marka eşleştirme şu anda yalnızca Dinamik sağlayıcısı için aktif.
          </div>
        )}
      </TabsContent>

      <TabsContent value="products">
        <SupplierMappingsClient
          initialLoaded={productTab.initialLoaded}
          initialData={productTab.initialData}
          initialSummary={productTab.initialSummary}
          initialFilters={productTab.initialFilters}
        />
      </TabsContent>
    </Tabs>
  )
}
