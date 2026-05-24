'use client'

import dynamic from 'next/dynamic'

const ProductTabsLazy = dynamic(
  () => import('./ProductTabsLazy').then((m) => m.ProductTabsLazy),
  {
    ssr: false,
    loading: () => (
      <div className="bg-background rounded-xl shadow-sm border border-border p-4 md:p-6">
        <div className="h-6 w-48 bg-muted rounded mb-4" />
        <div className="space-y-2">
          <div className="h-4 w-full bg-muted rounded" />
          <div className="h-4 w-5/6 bg-muted rounded" />
          <div className="h-4 w-4/6 bg-muted rounded" />
        </div>
      </div>
    )
  }
)

const RelatedProductsLazy = dynamic(
  () => import('./RelatedProductsLazy').then((m) => m.RelatedProductsLazy),
  {
    ssr: false,
    loading: () => (
      <div className="bg-background rounded-xl shadow-sm border border-border p-4 md:p-6 mt-4 md:mt-8">
        <div className="h-6 w-56 bg-muted rounded mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-48 bg-muted rounded-lg" />
          ))}
        </div>
      </div>
    )
  }
)

const ProductFAQ = dynamic(() => import('./ProductFAQ').then((m) => m.ProductFAQ), {
  ssr: false,
  loading: () => (
    <section className="bg-background border-t border-border py-12 md:py-16 mt-4 md:mt-8">
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-12">
          <div className="space-y-3">
            <div className="h-6 w-3/4 bg-muted rounded" />
            <div className="h-4 w-full bg-muted rounded" />
            <div className="h-4 w-5/6 bg-muted rounded" />
          </div>
          <div className="bg-background border border-border rounded-xl p-6 md:p-8 shadow-sm">
            <div className="w-full bg-muted rounded mb-3" />
            <div className="w-full bg-muted rounded mb-3" />
            <div className="h-24 w-full bg-muted rounded mb-3" />
            <div className="w-28 bg-muted rounded" />
          </div>
        </div>
      </div>
    </section>
  )
})

export function PartDetailLazySections({
  partId,
  categoryId,
  excludePartId,
  categoryName,
  productName,
  brandName
}: {
  partId: number
  categoryId: number
  excludePartId: number
  categoryName: string
  productName: string
  brandName: string
}) {
  return (
    <>
      <ProductTabsLazy partId={partId} />

      <div className="mt-4 md:mt-8">
        <RelatedProductsLazy
          categoryId={categoryId}
          excludePartId={excludePartId}
          categoryName={categoryName}
        />
      </div>

      <ProductFAQ
        partId={partId}
        productName={productName}
        brandName={brandName}
        categoryName={categoryName}
      />
    </>
  )
}
