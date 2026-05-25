'use client'

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  Clock,
  Layers,
  Link2,
  Package,
  Plug,
  Truck
} from 'lucide-react'
import { Link } from '@/lib/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type {
  SuppliersHubOverview,
  SuppliersHubProviderCard
} from '@/lib/types/suppliers-hub'

const providerIcons = {
  dinamik: Truck,
  parcatedarik: Package,
  basbug: Plug
} as const

const statusBadge: Record<
  SuppliersHubProviderCard['integrationStatus'],
  { label: string; className: string }
> = {
  active: {
    label: 'Aktif',
    className: 'bg-success/10 text-success border-success/25'
  },
  partial: {
    label: 'Kısmi',
    className: 'bg-warning/10 text-warning border-warning/25'
  },
  planned: {
    label: 'Planlandı',
    className: 'bg-muted text-muted-foreground border-border'
  }
}

const stepStatusDot = {
  ok: 'bg-success',
  warning: 'bg-warning',
  muted: 'bg-muted-foreground/40',
  blocked: 'bg-muted-foreground/25'
} as const

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('tr-TR', {
    dateStyle: 'short',
    timeStyle: 'short'
  })
}

function SummaryStrip({ overview }: { overview: SuppliersHubOverview }) {
  const { summary } = overview
  const items = [
    {
      label: 'Dinamik ürün',
      value: summary.totalDinamikProducts.toLocaleString('tr-TR'),
      sub: `${summary.unmatchedDinamikBrands.toLocaleString('tr-TR')} marka eşleşmedi`
    },
    {
      label: 'Bekleyen marka',
      value: summary.pendingBrandMatches.toLocaleString('tr-TR'),
      sub: 'dbrands_match PENDING'
    },
    {
      label: 'Bekleyen model',
      value: summary.pendingModelMatches.toLocaleString('tr-TR'),
      sub: 'dpmatch PENDING'
    },
    {
      label: 'ParçaTedarik ürün',
      value: summary.parcaProducts.toLocaleString('tr-TR'),
      sub:
        summary.parcaBrokenUrls > 0
          ? `${summary.parcaBrokenUrls.toLocaleString('tr-TR')} bozuk URL`
          : 'URL sağlığı iyi'
    }
  ]

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-xl border bg-card px-4 py-3 shadow-sm"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {item.label}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
            {item.value}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{item.sub}</p>
        </div>
      ))}
    </div>
  )
}

function PipelineStep({
  step,
  isLast
}: {
  step: SuppliersHubProviderCard['pipeline'][number]
  isLast: boolean
}) {
  return (
    <div className="relative flex gap-3 pb-4 last:pb-0">
      {!isLast ? (
        <span
          className="absolute left-[7px] top-4 h-[calc(100%-4px)] w-px bg-border"
          aria-hidden
        />
      ) : null}
      <span
        className={cn(
          'relative z-10 mt-1.5 size-3.5 shrink-0 rounded-full ring-2 ring-background',
          stepStatusDot[step.status]
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={step.href}
            className="text-sm font-medium text-foreground hover:text-primary"
          >
            {step.label}
          </Link>
          <Badge variant="secondary" className="tabular-nums font-normal">
            {step.count.toLocaleString('tr-TR')}
          </Badge>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{step.description}</p>
      </div>
    </div>
  )
}

function ProviderCard({ provider }: { provider: SuppliersHubProviderCard }) {
  const Icon = providerIcons[provider.id]
  const badge = statusBadge[provider.integrationStatus]

  return (
    <Card className="flex flex-col overflow-hidden">
      <CardHeader className="space-y-3 border-b bg-muted/30 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="size-5" aria-hidden />
            </div>
            <div>
              <CardTitle className="text-lg">{provider.name}</CardTitle>
              <CardDescription className="mt-0.5">{provider.subtitle}</CardDescription>
            </div>
          </div>
          <Badge variant="outline" className={cn('shrink-0', badge.className)}>
            {badge.label}
          </Badge>
        </div>
        {provider.baseUrl ? (
          <p className="truncate font-mono text-xs text-muted-foreground">
            {provider.baseUrl}
          </p>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-5 pt-5">
        <div className="grid grid-cols-2 gap-3">
          {provider.metrics.map((metric) => (
            <div
              key={metric.label}
              className="rounded-lg border bg-background/80 px-3 py-2.5"
              title={metric.hint}
            >
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {metric.label}
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums">
                {metric.value.toLocaleString('tr-TR')}
              </p>
              {metric.hint ? (
                <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">
                  {metric.hint}
                </p>
              ) : null}
            </div>
          ))}
        </div>

        {provider.syncHealth ? (
          <div className="rounded-lg border border-dashed px-3 py-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="size-3.5" aria-hidden />
                Son sync
              </span>
              <span className="font-medium">{formatDate(provider.lastSyncAt)}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
              <span>
                Durum:{' '}
                <strong className="text-foreground">
                  {provider.syncHealth.lastRunStatus ?? '—'}
                </strong>
              </span>
              <span>
                30g hata:{' '}
                <strong className="text-foreground">
                  %{provider.syncHealth.failedRate30d.toFixed(1)}
                </strong>
              </span>
            </div>
          </div>
        ) : null}

        {provider.id === 'parcatedarik' &&
        provider.metrics.some((m) => m.label.includes('Bozuk') && m.value > 0) ? (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              Bazı ürün URL’leri eksik veya geçersiz. Eşleştirme çalışır; scraper
              düzeltmesi sonraya bırakıldı.
            </span>
          </div>
        ) : null}

        <div>
          <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Layers className="size-3.5" aria-hidden />
            Veri hattı → Eşleştirme
          </p>
          <div>
            {provider.pipeline.map((step, index) => (
              <PipelineStep
                key={step.id}
                step={step}
                isLast={index === provider.pipeline.length - 1}
              />
            ))}
          </div>
        </div>
      </CardContent>

      <CardFooter className="mt-auto flex flex-wrap gap-2 border-t bg-muted/20 py-4">
        {provider.actions.map((action) => (
          <Button
            key={action.label}
            variant={action.variant === 'primary' ? 'default' : 'outline'}
            size="sm"
            asChild
            disabled={provider.integrationStatus === 'planned' && action.label === 'Yakında'}
          >
            <Link href={action.href}>
              {action.label}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </Button>
        ))}
      </CardFooter>
    </Card>
  )
}

export function SuppliersHubClient({ overview }: { overview: SuppliersHubOverview }) {
  return (
    <div className="space-y-8">
      <SummaryStrip overview={overview} />

      <section className="rounded-xl border bg-gradient-to-br from-muted/50 via-background to-background p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl space-y-2">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Link2 className="size-4 text-primary" aria-hidden />
              Eşleştirme merkezine bağlantı
            </h2>
            <p className="text-sm text-muted-foreground">
              Bu panel tedarikçi API ve katalog verisini yönetir. Onaylanan marka ve
              ürün eşleştirmeleri{' '}
              <Link href="/admin/eslestirme" className="font-medium text-foreground underline-offset-4 hover:underline">
                Eşleştirme Yönetimi
              </Link>{' '}
              ekranındaki tabloları besler. Stok ve fiyat politikası sonraki aşamada.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/admin/eslestirme?tab=brands">
                Marka eşleştirme
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/admin/eslestirme?tab=products">
                Ürün & model
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        {overview.providers.map((provider) => (
          <ProviderCard key={provider.id} provider={provider} />
        ))}
      </div>

      <section className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
        <p className="flex items-center gap-2 font-medium text-foreground">
          <CircleDashed className="size-4" aria-hidden />
          Diğer entegrasyonlar
        </p>
        <p className="mt-2">
          SETA ve Parts2World mevcut sync altyapısında duruyor; bu hub odaklı
          akış Dinamik ↔ ParçaTedarik eşleştirmesine göre kurgulandı.{' '}
          <Link
            href="/admin/suppliers/mappings"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Klasik mapping ekranı
          </Link>{' '}
          hâlâ erişilebilir.
        </p>
        <p className="mt-3 flex items-center gap-1.5 text-xs">
          <CheckCircle2 className="size-3.5 text-success" aria-hidden />
          Özet güncellendi: {formatDate(overview.generatedAt)}
        </p>
      </section>
    </div>
  )
}
