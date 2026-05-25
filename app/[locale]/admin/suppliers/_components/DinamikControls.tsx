'use client'

import { useEffect, useState, useTransition, type ReactNode } from 'react'
import {
  Database,
  Info,
  Loader2,
  Play,
  Save,
  ShieldCheck,
  Store,
  TestTube2
} from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { DinamikProxyDiagnostics } from '@/lib/types/dinamik-proxy'
import type { DbrandsAudit, DbrandsMatchAudit } from '@/lib/types/dbrands'
import {
  getDinamikDbrandsAudit,
  getDinamikDbrandsMatchAudit,
  runDinamikDbrandsMatchSeed,
  runDinamikDbrandsReconcile
} from '@/lib/actions/admin-dbrands'
import {
  previewDinamikStockListForBrand,
  runDinamikDproductsStockSync
} from '@/lib/actions/admin-dproducts'
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

function InfoHint({
  title,
  children
}: {
  title?: string
  children: ReactNode
}) {
  return (
    <Alert className="border-border/70 bg-muted/25 py-3">
      <Info className="text-muted-foreground" aria-hidden />
      {title ? <AlertTitle className="text-xs">{title}</AlertTitle> : null}
      <AlertDescription className="text-xs leading-relaxed">{children}</AlertDescription>
    </Alert>
  )
}

function SectionCard({
  step,
  title,
  description,
  children
}: {
  step: number
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border border-border bg-background p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          {step}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function AuditStat({
  label,
  value,
  tone = 'default'
}: {
  label: string
  value: number
  tone?: 'default' | 'warning'
}) {
  return (
    <div>
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <p
        className={
          tone === 'warning'
            ? 'font-semibold tabular-nums text-warning'
            : 'font-semibold tabular-nums text-foreground'
        }
      >
        {value.toLocaleString('tr-TR')}
      </p>
    </div>
  )
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
  const [lastResultSource, setLastResultSource] = useState<string | null>(null)
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

  const setResult = (source: string, data: unknown) => {
    setLastResultSource(source)
    setLastResult(data)
  }

  const runDbrandsReconcile = (apply: boolean) => {
    startTransition(async () => {
      const result = await runDinamikDbrandsReconcile({ apply, syncFromApi: true })
      if (!result.success) {
        toast.error(result.message)
        return
      }
      setResult(apply ? 'dbrands düzelt' : 'dbrands önizleme', result.data)
      toast.success(result.message)
      refreshDbrandsAudit()
    })
  }

  const runDproductsSync = (apply: boolean) => {
    const brand = brandInput.trim() || undefined
    startTransition(async () => {
      const result = await runDinamikDproductsStockSync({
        apply,
        brand,
        limitBrands: brand ? undefined : 5
      })
      if (!result.success) {
        toast.error(result.message)
        setResult(apply ? 'dproducts doldur' : 'dproducts önizleme', result.data)
        return
      }
      setResult(apply ? 'dproducts doldur' : 'dproducts önizleme', result.data)
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
      setResult(apply ? 'dbrands_match doldur' : 'match önizleme', result.data)
      toast.success(result.message)
      refreshDbrandsAudit()
    })
  }

  const runTest = (
    endpoint: 'getBrandList' | 'getStockList' | 'getPriceList' | 'getStock',
    options?: { persistDproducts?: boolean }
  ) => {
    startTransition(async () => {
      if (endpoint === 'getStockList') {
        const brand = brandInput.trim()
        if (!brand) {
          toast.error('getStockList için marka girin (dbrands.brand ile aynı yazım).')
          return
        }

        const result = await previewDinamikStockListForBrand({
          brand,
          persist: options?.persistDproducts === true
        })

        if (!result.success) {
          toast.error(result.message)
          return
        }

        setResult(
          options?.persistDproducts ? 'getStockList → dproducts' : 'getStockList test',
          { endpoint, ...result }
        )
        toast.success(result.message)
        if (options?.persistDproducts) {
          refreshDbrandsAudit()
        }
        return
      }

      const result = await testDinamikEndpoint({
        endpoint,
        brand: brandInput,
        stockCode: stockCodeInput
      })

      if (!result.success) {
        toast.error(result.message)
        return
      }

      setResult(`${endpoint} test`, { endpoint, ...result })
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

      setResult('mağaza senkronu', result.data)
      const payload = (result.data ?? null) as PricingPolicyUpdateResult | null
      const nextPolicy = payload?.pricingPolicy
      if (nextPolicy) {
        setEffectivePolicy(nextPolicy)
      }

      const recalculatedParts =
        typeof payload?.recalculatedParts === 'number'
          ? payload.recalculatedParts
          : 0

      toast.success(`${result.message} Yeniden hesaplanan ürün: ${recalculatedParts}.`)
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

      setResult('fiyat politikası', result.data)
      toast.success(result.message)
    })
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-background p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Dinamik API bağlantısı</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Katalog çekimi ve testler bu proxy üzerinden Dinamik API&apos;ye gider.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={
                proxyReady
                  ? 'border-success/20 bg-success/10 text-success'
                  : 'border-warning/20 bg-warning/10 text-warning'
              }
            >
              <ShieldCheck size={12} />
              {proxyReady
                ? `Proxy ${proxy.proxyHost}:${proxy.proxyPort}`
                : 'Proxy yapılandırılmadı'}
            </Badge>
            <Badge variant="outline" className="border-border bg-muted/50 text-foreground">
              {provider.status}
            </Badge>
          </div>
        </div>

        {!proxyReady ? (
          <div className="mt-4 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-xs text-warning">
            {proxy.setupError ??
              'DINAMIK_PROXY_URL eksik. Squid proxy adresini .env dosyasına ekleyin (ör. http://dinamik:SIFRE@173.249.36.2:8888), ardından uygulamayı yeniden başlatın.'}
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            IP whitelist için VPS üzerinden istek atılır. Kullanıcı:{' '}
            <span className="font-mono text-foreground">{proxy.proxyUser ?? '—'}</span>
          </p>
        )}
      </div>

      <InfoHint title="Önerilen akış">
        <ol className="list-decimal space-y-1 pl-4">
          <li>
            <strong>dbrands</strong> — API&apos;den marka listesini çekin ve tabloyu güncelleyin.
          </li>
          <li>
            <strong>dproducts</strong> — Seçili marka(lar) için stok ve fiyat satırlarını ham
            katalog tablosuna yazın.
          </li>
          <li>
            <strong>dbrands_match</strong> — Dinamik markalarını iç katalog markalarıyla
            eşleştirin (Eşleştirmeler ekranına gider).
          </li>
        </ol>
        <p className="mt-2">
          Mağazada satışa açık teklifler ve site fiyatları için ayrıca{' '}
          <strong>Mağaza senkronu</strong> sekmesini kullanın; bu adım{' '}
          <span className="font-mono">supplier_products</span> hattını besler.
        </p>
      </InfoHint>

      <div className="rounded-xl border border-border bg-background p-4">
        <p className="text-xs font-semibold text-foreground">İşlem parametreleri</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Marka alanı doldurulursa işlemler yalnızca o marka için çalışır; boş bırakılırsa
          katalog adımlarında güvenlik için ilk 5 marka kullanılır.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Marka (opsiyonel)</Label>
            <Input
              value={brandInput}
              onChange={(event) => setBrandInput(event.target.value)}
              placeholder="Örn: BOSCH — dbrands.brand ile aynı yazım"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              Stok kodu (yalnızca API testleri / getStock)
            </Label>
            <Input
              value={stockCodeInput}
              onChange={(event) => setStockCodeInput(event.target.value)}
              placeholder="Örn: ZM 0981"
            />
          </div>
        </div>
      </div>

      <Tabs defaultValue="catalog" className="rounded-xl border border-border bg-background p-4">
        <TabsList className="w-full flex-wrap h-auto gap-1">
          <TabsTrigger value="catalog" className="gap-1.5">
            <Database size={14} />
            Katalog (dbrands / dproducts)
          </TabsTrigger>
          <TabsTrigger value="tests" className="gap-1.5">
            <TestTube2 size={14} />
            API testleri
          </TabsTrigger>
          <TabsTrigger value="store" className="gap-1.5">
            <Store size={14} />
            Mağaza senkronu
          </TabsTrigger>
        </TabsList>

        <TabsContent value="catalog" className="mt-4 space-y-4">
          <SectionCard
            step={1}
            title="Marka kataloğu (dbrands)"
            description="getBrandList ile API markalarını çeker; tabloyu API ile hizalar ve tutarsız satırları düzeltir."
          >
            <InfoHint>
              Önce <strong>Önizleme</strong> ile kaç satır ekleneceğini/silineceğini görün. Sonuç
              uygunsa <strong>dbrands düzelt</strong> ile veritabanına yazın.{' '}
              <strong>Üretici adı (ürün yok)</strong> sayısı, Dinamik API&apos;de olup henüz{' '}
              <span className="font-mono">dproducts</span> tablosuna hiç ürün çekilmemiş ve adı
              ParçaTedarik üretici tablosuyla birebir örtüşen markalardır; düzeltme API
              senkronundan sonra bu satırları temizler.
            </InfoHint>
            {!auditLoading &&
            dbrandsAudit &&
            dbrandsAudit.manufacturerOnlyInDbrands > 0 ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Örnek: {dbrandsAudit.sampleManufacturerOnly.join(', ')}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
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
                disabled={isPending || auditLoading || !proxyReady}
                onClick={() => runDbrandsReconcile(true)}
              >
                dbrands düzelt
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={auditLoading}
                onClick={refreshDbrandsAudit}
              >
                Sayıları yenile
              </Button>
            </div>
            {auditLoading ? (
              <p className="mt-3 text-xs text-muted-foreground">Denetim yükleniyor…</p>
            ) : dbrandsAudit ? (
              <div className="mt-3 grid grid-cols-2 gap-3 text-xs lg:grid-cols-4">
                <AuditStat label="dbrands (Dinamik)" value={dbrandsAudit.dbrandsTotal} />
                <AuditStat
                  label="dproducts’ta marka sayısı"
                  value={dbrandsAudit.dproductsBrandTotal}
                />
                <AuditStat
                  label="Üretici adı (ürün yok)"
                  value={dbrandsAudit.manufacturerOnlyInDbrands}
                  tone="warning"
                />
                <AuditStat
                  label="Eksik dbrands"
                  value={dbrandsAudit.dproductsMissingInDbrands}
                />
              </div>
            ) : null}
          </SectionCard>

          <SectionCard
            step={2}
            title="Ürün kataloğu (dproducts)"
            description="Her dbrands.marka için getStockList + fiyat çekilir; ham ürün satırları dproducts tablosuna yazılır."
          >
            <InfoHint>
              Master kayıt <span className="font-mono">dproducts</span>; fiyat/stok/API ham veri{' '}
              <span className="font-mono">dproduct_details</span> tablosunda tutulur (değişimler{' '}
              <span className="font-mono">dproduct_history</span>). Yanıtta olmayan SKU&apos;lar{' '}
              silinmez, <span className="font-mono">is_passive=true</span> olur. Marka boşsa güvenlik
              için ilk 5 marka işlenir; tek marka veya tüm katalog için üstte marka girin veya CLI:{' '}
              <span className="font-mono">scripts/sync-dproducts-from-dbrands.ts</span>.
            </InfoHint>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending || auditLoading || !proxyReady}
                onClick={() => runDproductsSync(false)}
              >
                Önizleme
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={isPending || auditLoading || !proxyReady}
                onClick={() => runDproductsSync(true)}
              >
                dproducts doldur
              </Button>
            </div>
          </SectionCard>

          <SectionCard
            step={3}
            title="Marka eşleştirme (dbrands_match)"
            description="Dinamik marka adlarını ParçaTedarik üretici kayıtlarıyla eşleştirir; ürün eşleştirme ekranının ön koşuludur."
          >
            <InfoHint>
              Eşleşmiş çift sayısı arttıkça{' '}
              <strong>Tedarikçiler → Eşleştirmeler</strong> ekranında otomatik ürün eşleştirmesi
              daha verimli çalışır. Önce önizleme, sonra uygula.
            </InfoHint>
            {matchAudit ? (
              <div className="mt-3 grid grid-cols-2 gap-3 text-xs lg:grid-cols-4">
                <AuditStat label="Toplam satır" value={matchAudit.matchTotal} />
                <AuditStat label="Eşleşmiş çift" value={matchAudit.pairedRows} />
                <AuditStat
                  label="PT-only / eksik"
                  value={matchAudit.ptOnlyRows}
                  tone="warning"
                />
                <AuditStat label="Dinamik stub" value={matchAudit.dinamikStubRows} />
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending || auditLoading}
                onClick={() => runMatchSeed(false)}
              >
                Önizleme
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
          </SectionCard>
        </TabsContent>

        <TabsContent value="tests" className="mt-4 space-y-4">
          <InfoHint title="Ne zaman kullanılır?">
            Geliştirici veya destek ekibi için ham API yanıtını doğrulamak içindir. Günlük katalog
            güncellemesi için <strong>Katalog</strong> sekmesindeki adımları kullanın; buradaki
            testler veritabanına yazmaz (getStockList → dproducts hariç).
          </InfoHint>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => runTest('getBrandList')}
              disabled={isPending || !proxyReady}
            >
              {isPending ? (
                <Loader2 size={14} className="mr-2 animate-spin" />
              ) : (
                <TestTube2 size={14} className="mr-2" />
              )}
              getBrandList
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => runTest('getStockList')}
              disabled={isPending || !proxyReady}
            >
              getStockList
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => runTest('getStockList', { persistDproducts: true })}
              disabled={isPending || !proxyReady}
            >
              getStockList → dproducts (tek marka)
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => runTest('getPriceList')}
              disabled={isPending || !proxyReady}
            >
              getPriceList
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => runTest('getStock')}
              disabled={isPending || !proxyReady}
            >
              getStock
            </Button>
          </div>

          <ResultPanel source={lastResultSource} data={lastResult} />
        </TabsContent>

        <TabsContent value="store" className="mt-4 space-y-4">
          <InfoHint title="Mağaza hattı (supplier_products)">
            Bu senkron, ham katalog tablolarından (<span className="font-mono">dproducts</span>)
            bağımsız olarak çalışır: API&apos;den veriyi alır,{' '}
            <span className="font-mono">supplier_products</span> ve teklifleri günceller, ardından
            fiyat politikasını mağaza fiyatlarına uygular. Sayfa üstündeki &quot;Staging
            Ürün&quot; kartı bu hattın kayıt sayısıdır.
          </InfoHint>

          <div className="flex flex-wrap gap-2">
            <Button onClick={runSync} disabled={isPending || !proxyReady}>
              {isPending ? (
                <Loader2 size={14} className="mr-2 animate-spin" />
              ) : (
                <Play size={14} className="mr-2" />
              )}
              Mağaza senkronu başlat
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Marka boşsa ilk 3 marka işlenir. Tam katalog için zamanlanmış cron veya operasyon
            scriptlerini kullanın.
          </p>

          <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4">
            <p className="text-xs font-semibold text-foreground">Fiyat politikası (KDV hariç)</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Yalnızca mağaza senkronundan sonra site satış fiyatlarını hesaplar. dproducts ham
              alış fiyatını değiştirmez.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs lg:grid-cols-5">
              <div className="rounded-md border border-border bg-background px-2 py-1.5">
                İskonto: {(effectivePolicy.standardDiscountRate * 100).toFixed(2)}%
              </div>
              <div className="rounded-md border border-border bg-background px-2 py-1.5">
                Marj: {(effectivePolicy.marginRate * 100).toFixed(2)}%
              </div>
              <div className="rounded-md border border-border bg-background px-2 py-1.5">
                Sabit: {effectivePolicy.fixedFee.toFixed(2)} TRY
              </div>
              <div className="rounded-md border border-border bg-background px-2 py-1.5">
                {effectivePolicy.rounding}
              </div>
              <div className="rounded-md border border-border bg-background px-2 py-1.5">
                KDV: {effectivePolicy.vatMode}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Standart iskonto (%)</Label>
                <Input
                  value={standardDiscountRate}
                  onChange={(event) => setStandardDiscountRate(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Kar marjı (%)</Label>
                <Input
                  value={marginRate}
                  onChange={(event) => setMarginRate(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Sabit ücret (TRY)</Label>
                <Input value={fixedFee} onChange={(event) => setFixedFee(event.target.value)} />
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={savePricingPolicy}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 size={14} className="mr-2 animate-spin" />
              ) : (
                <Save size={14} className="mr-2" />
              )}
              Politikayı kaydet
            </Button>
          </div>

          <ResultPanel source={lastResultSource} data={lastResult} />
        </TabsContent>
      </Tabs>

      <InfoHint title="Stok ve fiyat geçmişi hakkında">
        Şu an <span className="font-mono">dproducts</span> her ürün için güncel fiyat/stok snapshot
        tutar; geçmiş versiyonlar ayrı tabloda değil. Mağaza hattında{' '}
        <span className="font-mono">supplier_sync_runs</span> her çalışmanın özetini,{' '}
        <span className="font-mono">supplier_products.last_seen_at</span> ise tazeliği izler. Fiyat
        değişim analitiği veya denetim ihtiyacı doğarsa{' '}
        <span className="font-mono">dproduct_history</span> gibi append-only bir tablo
        eklenebilir — şimdilik operasyonel ihtiyaç için snapshot yeterli.
      </InfoHint>
    </div>
  )
}

function ResultPanel({
  source,
  data
}: {
  source: string | null
  data: unknown
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <p className="text-xs font-semibold text-foreground">Son işlem çıktısı</p>
      {source ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">Kaynak: {source}</p>
      ) : null}
      <pre className="mt-2 max-h-52 overflow-auto text-xs text-foreground">
        {data ? JSON.stringify(data, null, 2) : 'Henüz işlem yapılmadı.'}
      </pre>
    </div>
  )
}
