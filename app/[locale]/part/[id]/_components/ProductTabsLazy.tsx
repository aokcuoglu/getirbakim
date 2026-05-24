'use client'

import { useEffect, useMemo, useState } from 'react'
import { ProductTabs } from './ProductTabs'

type TabsResponse = {
  data: {
    properties: { key: string; value: string }[]
    infos: string[]
    oens: { brand: string; code: string }[]
    crossReferences: {
      brandName: string
      articleNumber: string
      supplierProductId?: number | null
      partId?: number | null
    }[]
    compatibleVehicles: {
      id: number
      brandName: string
      modelName: string
      vehicleName: string
      typeName: string
      yearFrom: string | null
      yearTo: string | null
    }[]
  }
}

export function ProductTabsLazy({ partId }: { partId: number }) {
  const [data, setData] = useState<TabsResponse['data'] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const requestBody = useMemo(() => ({ partId }), [partId])

  useEffect(() => {
    let isActive = true
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort('timeout'), 15000)
    setError(null)

    fetch('/api/parts/tabs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          throw new Error(body?.error?.message || `Request failed (${res.status})`)
        }
        return (await res.json()) as TabsResponse
      })
      .then((json) => {
        if (!isActive) return
        setData(json.data)
      })
      .catch((e) => {
        if (!isActive) return
        if (e?.name === 'AbortError') {
          if (controller.signal.reason === 'timeout') {
            setError('Request timed out')
          }
          return
        }
        setError(e instanceof Error ? e.message : 'Failed to load details')
      })

    return () => {
      isActive = false
      clearTimeout(timeout)
      controller.abort('cleanup')
    }
  }, [requestBody])

  if (error) {
    return (
      <div className="bg-background rounded-xl shadow-sm border border-border p-4 md:p-6 text-sm text-muted-foreground">
        {error || 'Failed to load details.'}
      </div>
    )
  }

  if (!data) {
    return (
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

  return (
    <ProductTabs
      properties={data.properties}
      infos={data.infos}
      oens={data.oens}
      compatibleVehicles={data.compatibleVehicles}
      crossReferences={data.crossReferences}
    />
  )
}
