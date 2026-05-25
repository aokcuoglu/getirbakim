'use client'

import { useEffect, useState, useTransition } from 'react'
import { Database, Loader2, Play, Save, ShieldCheck, TestTube2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { DinamikProxyDiagnostics } from '@/lib/types/dinamik-proxy'
import type { DbrandsAudit, DbrandsMatchAudit } from '@/lib/types/dbrands'
import {
  getDinamikDbrandsAudit,
  getDinamikDbrandsMatchAudit,
  runDinamikDbrandsMatchSeed,
  runDinamikDbrandsReconcile
} from '@/lib/actions/admin-dbrands'
import {
  testDinamikEndpoint,
  triggerDinamikSync,
  updateDinamikPricingPolicy
} from '@/lib/actions/admin-suppliers'

interface DinamikControlsProps {
  proxy: DinamikProxyDiagnostics
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

export function DinamikControls({ provider, proxy }: DinamikControlsProps) {
  const proxyReady = proxy.configured && !proxy.setupError
  const [isPending, startTransition] = useTransition()
  const [dbrandsAudit, setDbrandsAudit] = useState<DbrandsAudit | null>(null)
  const [matchAudit, setMatchAudit] = useState<DbrandsMatchAudit | null>(null)
  const [auditLoading, setAuditLoading] = useState(true)
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

  const refreshDbrandsAudit = () => {
    setAuditLoading(true)
    void Promise.all([getDinamikDbrandsAudit(), getDinamikDbrandsMatchAudit()]).then(
      ([dbrandsResult, matchResult]) => {
        if (dbrandsResult.success && dbrandsResult.data) {
          setDbrandsAudit(dbrandsResult.data)
        } else if (dbrandsResult.message) {
          toast.error(dbrandsResult.message)
        }
        if (matchResult.success && matchResult.data) {
          setMatchAudit(matchResult.data)
        } else if (matchResult.message) {
          toast.error(matchResult.message)
        }
        setAuditLoading(false)
      }
    )
  }

  useEffect(() => {
    refreshDbrandsAudit()
  }, [])

  const runDbrandsReconcile = (apply: boolean) => {
    startTransition(async () => {
      const result = await runDinamikDbrandsReconcile({ apply, syncFromApi: true })
      if (!result.success) {
        toast.error(result.message)
        return
      }
      setLastResult(result.data)
      toast.success(result.message)
      refreshDbrandsAudit()
    })
  }

  const runMatchSeed = (apply: boolean) => {
    startTransition(async () => {
      const result = await runDinamikDbrandsMatchSeed({ apply, runAutoMatch: true })
      if (!result.success) {
        toast.error(result.message)
        return
      }
      setLastResult(result.data)
      toast.success(result.message)
      refreshDbrandsAudit()
    })
  }

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
      if (endpoint === 'getBrandList') {
        refreshDbrandsAudit()
      }
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
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={
              proxyReady
                ? 'bg-success/10 text-success border-success/20'
                : 'bg-warning/10 text-warning border-warning/20'
            }
          >
            <ShieldCheck size={12} />
            {proxyReady
              ? `Proxy ${proxy.proxyHost}:${proxy.proxyPort}`
              : 'Proxy yapılandırılmadı'}
          </Badge>
          <Badge variant="outline" className="bg-muted/50 text-foreground border-border">
            {provider.status}
          </Badge>
        </div>
      </div>

      {!proxyReady ? (
        <div className="mt-4 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-xs text-warning">
          {proxy.setupError ??
            'DINAMIK_PROXY_URL eksik. Postman’de kullandığınız Squid adresini .env dosyasına ekleyin (ör. http://dinamik:SIFRE@173.249.36.2:8888), ardından Docker’ı yeniden başlatın.'}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          İstekler VPS üzerinden Dinamik API’ye gider (IP whitelist). Kullanıcı:{' '}
          <span className="font-mono text-foreground">{proxy.proxyUser ?? '—'}</span>
        </p>
      )}

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

      <div className="mt-4 rounded-md border border-border bg-muted/40 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Database size={14} aria-hidden />
            dbrands kataloğu
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending || auditLoading}
              onClick={() => runDbrandsReconcile(false)}
            >
              Önizleme
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isPending || auditLoading}
              onClick={() => runDbrandsReconcile(true)}
            >
              dbrands düzelt
            </Button>
          </div>
        </div>
        {auditLoading ? (
          <p className="mt-2 text-xs text-muted-foreground">Denetim yükleniyor…</p>
        ) : (
          <div className="mt-2 space-y-3">
            {dbrandsAudit ? (
              <div className="grid grid-cols-2 gap-2 text-xs lg:grid-cols-4">
                <div>
                  <span className="text-muted-foreground">dbrands (Dinamik)</span>
                  <p className="font-semibold tabular-nums">
                    {dbrandsAudit.dbrandsTotal.toLocaleString('tr-TR')}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">dproducts marka</span>
                  <p className="font-semibold tabular-nums">
                    {dbrandsAudit.dproductsBrandTotal.toLocaleString('tr-TR')}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Yanlış dbrands</span>
                  <p className="font-semibold tabular-nums text-warning">
                    {dbrandsAudit.manufacturerOnlyInDbrands.toLocaleString('tr-TR')}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Eksik dbrands</span>
                  <p className="font-semibold tabular-nums">
                    {dbrandsAudit.dproductsMissingInDbrands.toLocaleString('tr-TR')}
                  </p>
                </div>
              </div>
            ) : null}
            {matchAudit ? (
              <div className="rounded-md border border-border/60 bg-background/80 p-2">
                <p className="text-[11px] font-medium text-muted-foreground">
                  dbrands_match (eşleştirme kuyruğu)
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs lg:grid-cols-4">
                  <div>
                    <span className="text-muted-foreground">Toplam satır</span>
                    <p className="font-semibold tabular-nums">
                      {matchAudit.matchTotal.toLocaleString('tr-TR')}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Eşleşmiş çift</span>
                    <p className="font-semibold tabular-nums">
                      {matchAudit.pairedRows.toLocaleString('tr-TR')}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">PT-only (Dinamik yok)</span>
                    <p className="font-semibold tabular-nums text-warning">
                      {matchAudit.ptOnlyRows.toLocaleString('tr-TR')} / eksik{' '}
                      {matchAudit.manufacturersMissingFromMatch.toLocaleString('tr-TR')}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Dinamik stub</span>
                    <p className="font-semibold tabular-nums">
                      {matchAudit.dinamikStubRows.toLocaleString('tr-TR')}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending || auditLoading}
            onClick={() => runMatchSeed(false)}
          >
            Match önizleme
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isPending || auditLoading}
            onClick={() => runMatchSeed(true)}
          >
            dbrands_match doldur
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => runTest('getBrandList')}
          disabled={isPending || !proxyReady}
        >
          {isPending ? <Loader2 size={14} className="mr-2 animate-spin" /> : <TestTube2 size={14} className="mr-2" />}
          getBrandList Test
        </Button>
        <Button
          variant="outline"
          onClick={() => runTest('getStockList')}
          disabled={isPending || !proxyReady}
        >
          getStockList Test
        </Button>
        <Button
          variant="outline"
          onClick={() => runTest('getPriceList')}
          disabled={isPending || !proxyReady}
        >
          getPriceList Test
        </Button>
        <Button
          variant="outline"
          onClick={() => runTest('getStock')}
          disabled={isPending || !proxyReady}
        >
          getStock Test
        </Button>
        <Button onClick={runSync} disabled={isPending || !proxyReady}>
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
