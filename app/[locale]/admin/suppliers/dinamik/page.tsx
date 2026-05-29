import { AlertTriangle, DatabaseZap, GitMerge, PackageSearch, Tags } from 'lucide-react'
import { notFound } from 'next/navigation'
import type { ElementType } from 'react'
import {
  AdminPageHeader,
  AdminPageShell,
  AdminSurface
} from '@/components/admin/admin-page-shell'
import { getAdminBreadcrumbs } from '@/lib/admin/breadcrumbs'
import { Badge } from '@/components/ui/badge'
import { getDinamikDbrandsAudit } from '@/lib/actions/admin-dnbrd'
import { getAdminSupplierProviderDetail } from '@/lib/actions/admin-suppliers'
import { getDinamikProxyDiagnostics } from '@/lib/dinamik'
import { DinamikControls } from '../_components/DinamikControls'

export default async function AdminDinamikSupplierPage() {
  const [result, dnbrdAuditResult] = await Promise.all([
    getAdminSupplierProviderDetail('dinamik'),
    getDinamikDbrandsAudit()
  ])

  if (!result.success || !result.data) {
    notFound()
  }

  const detail = result.data
  const proxy = getDinamikProxyDiagnostics()
  const catalogAudit = dnbrdAuditResult.success ? dnbrdAuditResult.data : null

  return (
    <AdminPageShell>
        <AdminPageHeader
          title="Dinamik Sağlayıcı Yönetimi"
          description="Dinamik API'den marka ve ürün kataloğunu çekin; mağaza teklifleri ve senkron geçmişini ayrı hatlarda izleyin."
          breadcrumbs={getAdminBreadcrumbs('/admin/suppliers/dinamik')}
        />

        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Ham katalog (parcatedarik)
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="dnbrd"
              value={catalogAudit?.dnbrdTotal ?? 0}
              hint="API marka listesi"
              icon={Tags}
            />
            <MetricCard
              label="dnprd marka"
              value={catalogAudit?.dnprdBrandTotal ?? 0}
              hint="Ürünü olan marka sayısı"
              icon={Tags}
            />
            <MetricCard
              label="Üretici adı (ürün yok)"
              value={catalogAudit?.manufacturerOnlyInDbrands ?? 0}
              hint="dnprd'ta ürünü olmayan PT üretici adları"
              icon={AlertTriangle}
              tone="warning"
            />
            <MetricCard
              label="Eksik dnbrd"
              value={catalogAudit?.dnprdMissingInDbrands ?? 0}
              hint="dnprd'ta olup dnbrd'ta yok"
              icon={AlertTriangle}
            />
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Mağaza hattı (supplier_products)
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Staging ürün"
              value={detail.counts.productCount}
              hint="supplier_products kayıt"
              icon={PackageSearch}
            />
            <MetricCard
              label="Aktif teklif"
              value={detail.counts.offerCount}
              hint="Satışa açık part_supplier_offers"
              icon={DatabaseZap}
            />
            <MetricCard
              label="Mapping kuyruğu"
              value={detail.counts.queueCount}
              hint="Onay bekleyen eşleştirme"
              icon={GitMerge}
            />
            <MetricCard
              label="Ignore"
              value={detail.counts.ignoredCount}
              hint="Kalıcı olarak dışlanan"
              icon={AlertTriangle}
            />
          </div>
        </div>

        <DinamikControls provider={detail.provider} proxy={proxy} />

        <AdminSurface className="p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Senkron çalışma geçmişi</h2>
              <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                Her <strong>mağaza senkronu</strong> veya zamanlanmış görev bir satır oluşturur.
                Başarısız satırlar API veya eşleştirme hatalarını gösterir; katalog (
                dnbrd/dnprd) adımları bu tabloya yazılmaz.
              </p>
            </div>
            {detail.provider.lastSyncAt ? (
              <p className="shrink-0 text-xs text-muted-foreground">
                Son mağaza senkronu:{' '}
                <time dateTime={detail.provider.lastSyncAt}>
                  {new Date(detail.provider.lastSyncAt).toLocaleString('tr-TR')}
                </time>
              </p>
            ) : null}
          </div>

          <div className="mt-3 space-y-3 md:hidden">
            {detail.runs.length === 0 ? (
              <div className="rounded-lg border border-border px-3 py-6 text-center text-sm text-muted-foreground">
                Henüz mağaza senkron kaydı yok. Mağaza sekmesinden ilk çalıştırmayı
                yapabilirsiniz.
              </div>
            ) : (
              detail.runs.map((run) => (
                <article key={run.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-foreground">#{run.id}</p>
                    <RunStatusBadge status={run.status} />
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    <p>Tetikleyici: {formatTriggerType(run.triggerType)}</p>
                    <p className="font-mono text-[11px]">{run.endpoint || '—'}</p>
                    <p>
                      Başlangıç:{' '}
                      {run.startedAt
                        ? new Date(run.startedAt).toLocaleString('tr-TR')
                        : '—'}
                    </p>
                    <p>
                      İşlenen: {run.totalCount} · Başarısız: {run.failedCount}
                    </p>
                    {run.errorSummary ? (
                      <p className="line-clamp-3 text-warning">{run.errorSummary}</p>
                    ) : null}
                  </div>
                </article>
              ))
            )}
          </div>

          <div className="mt-3 hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <th className="px-2 py-2">#</th>
                  <th className="px-2 py-2">Tetikleyici</th>
                  <th className="px-2 py-2">Durum</th>
                  <th className="px-2 py-2">Endpoint</th>
                  <th className="px-2 py-2">Başlangıç</th>
                  <th className="px-2 py-2">İşlenen</th>
                  <th className="px-2 py-2">Başarısız</th>
                  <th className="px-2 py-2">Özet</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {detail.runs.map((run) => (
                  <tr key={run.id}>
                    <td className="px-2 py-2 font-semibold">#{run.id}</td>
                    <td className="px-2 py-2 text-xs">
                      {formatTriggerType(run.triggerType)}
                    </td>
                    <td className="px-2 py-2">
                      <RunStatusBadge status={run.status} />
                    </td>
                    <td className="px-2 py-2 font-mono text-[11px] text-muted-foreground">
                      {run.endpoint || '—'}
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {run.startedAt
                        ? new Date(run.startedAt).toLocaleString('tr-TR')
                        : '—'}
                    </td>
                    <td className="px-2 py-2 tabular-nums">{run.totalCount}</td>
                    <td className="px-2 py-2 tabular-nums">{run.failedCount}</td>
                    <td className="max-w-xs px-2 py-2 text-xs text-muted-foreground">
                      {run.errorSummary || '—'}
                    </td>
                  </tr>
                ))}
                {detail.runs.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-2 py-8 text-center text-muted-foreground">
                      Henüz mağaza senkron kaydı yok.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </AdminSurface>
    </AdminPageShell>
  )
}

function formatTriggerType(trigger: string): string {
  switch (trigger) {
    case 'MANUAL':
      return 'Manuel (admin)'
    case 'SCHEDULED':
      return 'Zamanlanmış (cron)'
    case 'CRON':
      return 'Zamanlanmış (cron)'
    default:
      return trigger
  }
}

function RunStatusBadge({ status }: { status: string }) {
  const normalized = status.toUpperCase()
  const className =
    normalized === 'COMPLETED' || normalized === 'SUCCESS'
      ? 'border-success/20 bg-success/10 text-success'
      : normalized === 'RUNNING'
        ? 'border-primary/20 bg-primary/10 text-primary'
        : normalized === 'FAILED'
          ? 'border-destructive/20 bg-destructive/10 text-destructive'
          : 'border-border bg-muted/50 text-foreground'

  return (
    <Badge variant="outline" className={className}>
      {status}
    </Badge>
  )
}

function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default'
}: {
  label: string
  value: number
  hint: string
  icon: ElementType
  tone?: 'default' | 'warning'
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <Icon size={14} className="text-muted-foreground" />
      </div>
      <p
        className={
          tone === 'warning'
            ? 'mt-2 text-2xl font-bold tabular-nums text-warning'
            : 'mt-2 text-2xl font-bold tabular-nums text-foreground'
        }
      >
        {value.toLocaleString('tr-TR')}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  )
}
