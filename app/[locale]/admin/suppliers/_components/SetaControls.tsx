'use client'

import { useState, useTransition } from 'react'
import { Loader2, Play } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { triggerSetaCatalogRemap, triggerSetaSync } from '@/lib/actions/admin-suppliers'

interface SetaControlsProps {
  provider: {
    code: string
    name: string
    status: string
  }
}

export function SetaControls({ provider }: SetaControlsProps) {
  const [isPending, startTransition] = useTransition()
  const [mode, setMode] = useState<'full' | 'delta'>('delta')
  const [brandInput, setBrandInput] = useState('')
  const [limitProducts, setLimitProducts] = useState('500')
  const [onlyQueued, setOnlyQueued] = useState(true)
  const [lastResult, setLastResult] = useState<unknown>(null)

  const runSync = () => {
    startTransition(async () => {
      const result = await triggerSetaSync({
        mode,
        brand: brandInput || undefined,
        limitProducts: Number(limitProducts)
      })

      if (!result.success) {
        toast.error(result.message)
        return
      }

      setLastResult(result.data)
      toast.success(result.message)
    })
  }

  const runCatalogRemap = () => {
    startTransition(async () => {
      const result = await triggerSetaCatalogRemap({
        limitProducts: Number(limitProducts),
        onlyQueued
      })

      if (!result.success) {
        toast.error(result.message)
        return
      }

      setLastResult(result.data)
      toast.success(result.message)
    })
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[#101828]">SETA Sync Kontrolleri</h2>
          <p className="mt-1 text-xs text-gray-500">
            Sağlayıcı: {provider.name} ({provider.code}) - {provider.status}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Mod</label>
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as 'full' | 'delta')}
            className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm"
          >
            <option value="delta">Delta</option>
            <option value="full">Full</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Marka (opsiyonel)</label>
          <input
            value={brandInput}
            onChange={(event) => setBrandInput(event.target.value)}
            placeholder="Örn: BOSCH"
            className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Limit Ürün</label>
          <input
            value={limitProducts}
            onChange={(event) => setLimitProducts(event.target.value)}
            placeholder="500"
            className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm"
          />
        </div>
      </div>

      <div className="mt-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <Button
            onClick={runSync}
            disabled={isPending}
            className="bg-[#101828] hover:bg-[#1d2939]"
          >
            {isPending ? (
              <Loader2 size={14} className="mr-2 animate-spin" />
            ) : (
              <Play size={14} className="mr-2" />
            )}
            SETA Sync Başlat
          </Button>
          <Button onClick={runCatalogRemap} disabled={isPending} variant="outline">
            {isPending ? (
              <Loader2 size={14} className="mr-2 animate-spin" />
            ) : (
              <Play size={14} className="mr-2" />
            )}
            OEM Remap (Catalog)
          </Button>
          <label className="inline-flex items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={onlyQueued}
              onChange={(event) => setOnlyQueued(event.target.checked)}
            />
            Sadece queue kayıtlar
          </label>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <p className="text-xs font-semibold text-gray-600">Son Sonuç</p>
        <pre className="mt-2 max-h-52 overflow-auto text-xs text-gray-700">
          {lastResult ? JSON.stringify(lastResult, null, 2) : 'Henüz işlem yapılmadı.'}
        </pre>
      </div>
    </div>
  )
}
