'use client'

import { useEffect, useMemo, useState } from 'react'
import { RelatedProducts } from './RelatedProducts'

type RelatedPart = {
  id: number
  name: string
  price: string | null
  stockQty: number
  priceSource: 'real' | 'placeholder'
  isPlaceholderPrice: boolean
  isPurchasable: boolean
  brandName: string
  brandLogo: string | null
  thumb: string | null
  image: string | null
  properties: { key: string; value: string }[]
  eans: string[]
  isVehicleSpecific: boolean
  isBestseller: boolean
}

type RelatedResponse = { parts: RelatedPart[] }

export function RelatedProductsLazy({
  categoryId,
  excludePartId,
  categoryName
}: {
  categoryId: number
  excludePartId: number
  categoryName: string
}) {
  const [parts, setParts] = useState<RelatedPart[] | null>(null)

  const body = useMemo(
    () => ({ categoryId, excludePartId, limit: 6 }),
    [categoryId, excludePartId]
  )

  useEffect(() => {
    const controller = new AbortController()

    fetch('/api/parts/related', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    })
      .then(async (res) => {
        if (!res.ok) return { parts: [] } as RelatedResponse
        return (await res.json()) as RelatedResponse
      })
      .then((json) => setParts(json.parts))
      .catch((e) => {
        if (e?.name === 'AbortError') return
        setParts([])
      })

    return () => controller.abort()
  }, [body])

  if (parts == null) {
    return (
      <div className="bg-background rounded-xl shadow-sm border border-border p-4 md:p-6">
        <div className="h-6 w-56 bg-muted rounded mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-48 bg-muted rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  if (parts.length === 0) return null

  return <RelatedProducts parts={parts} categoryName={categoryName} />
}
