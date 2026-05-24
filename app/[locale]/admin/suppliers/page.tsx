import { ArrowRight, Link2, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { AdminLayout } from '@/components/admin/admin-layout'
import {
  AdminPageHeader,
  AdminPageShell,
  AdminSurface
} from '@/components/admin/admin-page-shell'
import { Link } from '@/lib/navigation'
import { getAdminSupplierProviders } from '@/lib/actions/admin-suppliers'

export default async function AdminSuppliersPage() {
  const providers = await getAdminSupplierProviders()

  return (
    <AdminLayout>
      <AdminPageShell>
        <AdminPageHeader
          title="Tedarikçiler"
          description="Çoklu tedarikçi bağlantıları, sync sağlığı ve mapping operasyonlarını yönetin."
          eyebrow="Entegrasyon"
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {providers.map((provider) => (
            <article
              key={provider.id}
              className="rounded-2xl border border-border bg-background p-5 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {provider.code}
                  </p>
                  <h2 className="text-lg font-semibold text-foreground">{provider.name}</h2>
                </div>
                <Badge
                  variant="outline"
                  className={
                    provider.status === 'ACTIVE'
                      ? 'text-[11px] bg-success/10 text-success border-success/20'
                      : 'text-[11px] bg-destructive/10 text-destructive border-destructive/20'
                  }
                >
                  {provider.status}
                </Badge>
              </div>

              <div className="mt-4 space-y-2 text-sm text-foreground">
                <p>
                  Öncelik: <span className="font-semibold">{provider.priority}</span>
                </p>
                <p>
                  Plan: <span className="font-semibold">{provider.schedule || '-'}</span>
                </p>
                <p>
                  Son Senkron:{' '}
                  <span className="font-semibold">
                    {provider.lastSyncAt
                      ? new Date(provider.lastSyncAt).toLocaleString('tr-TR')
                      : 'Kayıt yok'}
                  </span>
                </p>
                <p>
                  30g Hata Oranı:{' '}
                  <span className="font-semibold">%{provider.syncStats.failedRate30d.toFixed(2)}</span>
                </p>
                <p>
                  30g Run Sayısı:{' '}
                  <span className="font-semibold">{provider.syncStats.totalRuns30d}</span>
                </p>
              </div>

              {provider.productCounts.total > 0 ? (
                <>
                  <hr className="my-3 border-border" />
                  <div className="space-y-1.5 text-sm text-foreground">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Ürünler</span>
                      <span className="font-semibold text-foreground">
                        {provider.productCounts.total.toLocaleString('tr-TR')}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="shrink-0 text-muted-foreground">Eşleşen</span>
                      <div className="flex flex-1 items-center justify-end gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-success/100"
                            style={{
                              width: `${Math.min(
                                100,
                                Math.round(
                                  (provider.productCounts.approved /
                                    Math.max(1, provider.productCounts.total)) *
                                    100
                                )
                              )}%`
                            }}
                          />
                        </div>
                        <span className="font-semibold text-foreground">
                          {provider.productCounts.approved.toLocaleString('tr-TR')}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Kuyruk</span>
                      <span className="font-semibold text-warning">
                        {provider.productCounts.queue.toLocaleString('tr-TR')}
                      </span>
                    </div>
                    {provider.productCounts.ignored > 0 ? (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Yoksayılan</span>
                        <span className="font-semibold text-muted-foreground">
                          {provider.productCounts.ignored.toLocaleString('tr-TR')}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}

              <div className="mt-4 flex gap-2">
                <Link
                  href={`/admin/suppliers/${provider.code}`}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
                >
                  <Link2 size={14} />
                  Sağlayıcı Detayı
                </Link>
                <Link
                  href={`/admin/suppliers/mappings?provider=${provider.code}&tab=products`}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
                >
                  <RefreshCw size={14} />
                  Mapping
                </Link>
              </div>
            </article>
          ))}

          {providers.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-input bg-background p-10 text-center text-sm text-muted-foreground">
              Tedarikçi kaydı bulunamadı.
            </div>
          )}
        </div>

        <AdminSurface className="p-4">
          <Link
            href="/admin/suppliers/mappings?provider=dinamik&tab=products"
            className="inline-flex items-center gap-2 text-sm font-semibold text-foreground"
          >
            Eşleştirme kuyruğunu aç
            <ArrowRight size={14} />
          </Link>
        </AdminSurface>
      </AdminPageShell>
    </AdminLayout>
  )
}
