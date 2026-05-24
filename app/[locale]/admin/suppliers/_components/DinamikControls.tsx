'use client'

import { useState, useTransition } from 'react'
import { Loader2, Play, Save, ShieldCheck, TestTube2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  testDinamikEndpoint,
  triggerDinamikSync,
  updateDinamikPricingPolicy
} from '@/lib/actions/admin-suppliers'

interface DinamikControlsProps {
  provider: {
    id: number
    code: string
    name: string
    status: string
    priority: number
    schedule: string | null
    baseUrl: string | null
    config: unknown
    pricingPolicy: {
      standardDiscountRate: number
      marginRate: number
      fixedFee: number
      rounding: 'HALF_UP_2'
      vatMode: 'EXCLUDED'
    }
    updatedAt: string | null
    lastSyncAt: string | null
  }
}

type PricingPolicyUpdateResult = {
  pricingPolicy?: {
    standardDiscountRate: number
    marginRate: number
    fixedFee: number
    rounding: 'HALF_UP_2'
    vatMode: 'EXCLUDED'
  }
  recalculatedParts?: number
}

export function DinamikControls({ provider }: DinamikControlsProps) {
  const [isPending, startTransition] = useTransition()
  const [brandInput, setBrandInput] = useState('')
  const [stockCodeInput, setStockCodeInput] = useState('')
  const [lastResult, setLastResult] = useState<unknown>(null)
  const [effectivePolicy, setEffectivePolicy] = useState(provider.pricingPolicy)
  const [standardDiscountRate, setStandardDiscountRate] = useState(
    String((provider.pricingPolicy.standardDiscountRate * 100).toFixed(2))
  )
  const [marginRate, setMarginRate] = useState(
    String((provider.pricingPolicy.marginRate * 100).toFixed(2))
  )
  const [fixedFee, setFixedFee] = useState(
    String(provider.pricingPolicy.fixedFee.toFixed(2))
  )

  const runTest = (endpoint: 'getBrandList' | 'getStockList' | 'getPriceList' | 'getStock') => {
    startTransition(async () => {
      const result = await testDinamikEndpoint({
        endpoint,
        brand: brandInput,
        stockCode: stockCodeInput
      })

      if (!result.success) {
        toast.error(result.message)
        return
      }

      setLastResult({ endpoint, ...result })
      toast.success(result.message)
    })
  }

  const runSync = () => {
    startTransition(async () => {
      const result = await triggerDinamikSync({
        brand: brandInput || undefined,
        limitBrands: brandInput ? undefined : 3
      })

      if (!result.success) {
        toast.error(result.message)
        return
      }

      setLastResult(result.data)
      const payload = (result.data ?? null) as PricingPolicyUpdateResult | null
      const nextPolicy = payload?.pricingPolicy
      if (nextPolicy) {
        setEffectivePolicy(nextPolicy)
      }

      const recalculatedParts =
        typeof payload?.recalculatedParts === 'number'
          ? payload.recalculatedParts
          : 0

      toast.success(`${result.message} Yeniden hesaplanan urun: ${recalculatedParts}.`)
    })
  }

  const savePricingPolicy = () => {
    startTransition(async () => {
      const result = await updateDinamikPricingPolicy({
        standardDiscountRate: Number(standardDiscountRate),
        marginRate: Number(marginRate),
        fixedFee: Number(fixedFee)
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
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">API Yönetim Paneli</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Endpoint testleri ve manuel sync tetikleme. Sağlayıcı: {provider.name} ({provider.code})
          </p>
        </div>
        <Badge variant="outline" className="bg-success/10 text-success border-success/20">
          <ShieldCheck size={12} />
          {provider.status}
        </Badge>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Marka (opsiyonel)</Label>
          <Input
            value={brandInput}
            onChange={(event) => setBrandInput(event.target.value)}
            placeholder="Örn: BOSCH"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Stok Kodu (getStock)</Label>
          <Input
            value={stockCodeInput}
            onChange={(event) => setStockCodeInput(event.target.value)}
            placeholder="Örn: ZM 0981"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => runTest('getBrandList')} disabled={isPending}>
          {isPending ? <Loader2 size={14} className="mr-2 animate-spin" /> : <TestTube2 size={14} className="mr-2" />}
          getBrandList Test
        </Button>
        <Button variant="outline" onClick={() => runTest('getStockList')} disabled={isPending}>
          getStockList Test
        </Button>
        <Button variant="outline" onClick={() => runTest('getPriceList')} disabled={isPending}>
          getPriceList Test
        </Button>
        <Button variant="outline" onClick={() => runTest('getStock')} disabled={isPending}>
          getStock Test
        </Button>
        <Button onClick={runSync} disabled={isPending}>
          {isPending ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Play size={14} className="mr-2" />}
          Manuel Sync Başlat
        </Button>
      </div>

      <div className="mt-4 rounded-md border border-border bg-muted p-3">
        <p className="text-xs font-semibold text-muted-foreground">Current Effective Policy</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Son guncelleme: {provider.updatedAt ?? 'Bilinmiyor'}
        </p>
        <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-foreground lg:grid-cols-5">
          <div className="rounded-md border border-border bg-background px-2 py-1">
            Iskonto: {(effectivePolicy.standardDiscountRate * 100).toFixed(2)}%
          </div>
          <div className="rounded-md border border-border bg-background px-2 py-1">
            Marj: {(effectivePolicy.marginRate * 100).toFixed(2)}%
          </div>
          <div className="rounded-md border border-border bg-background px-2 py-1">
            Sabit: {effectivePolicy.fixedFee.toFixed(2)} TRY
          </div>
          <div className="rounded-md border border-border bg-background px-2 py-1">
            Rounding: {effectivePolicy.rounding}
          </div>
          <div className="rounded-md border border-border bg-background px-2 py-1">
            VAT: {effectivePolicy.vatMode}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-border bg-muted p-3">
        <p className="text-xs font-semibold text-muted-foreground">Pricing Policy (KDV Haric)</p>
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Standart Iskonto (%)</Label>
            <Input
              value={standardDiscountRate}
              onChange={(event) => setStandardDiscountRate(event.target.value)}
              placeholder="0"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Kar Marji (%)</Label>
            <Input
              value={marginRate}
              onChange={(event) => setMarginRate(event.target.value)}
              placeholder="0"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Sabit Ucret (TRY)</Label>
            <Input
              value={fixedFee}
              onChange={(event) => setFixedFee(event.target.value)}
              placeholder="0"
            />
          </div>
        </div>
        <div className="mt-3">
          <Button variant="outline" onClick={savePricingPolicy} disabled={isPending}>
            {isPending ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Save size={14} className="mr-2" />}
            Pricing Policy Kaydet
          </Button>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-border bg-muted p-3">
        <p className="text-xs font-semibold text-muted-foreground">Son Sonuç</p>
        <pre className="mt-2 max-h-52 overflow-auto text-xs text-foreground">
          {lastResult ? JSON.stringify(lastResult, null, 2) : 'Henüz işlem yapılmadı.'}
        </pre>
      </div>
    </div>
  )
}
