import { ArrowRight, Link2, RefreshCw } from 'lucide-react'
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
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {provider.code}
                  </p>
                  <h2 className="text-lg font-semibold text-slate-900">{provider.name}</h2>
                </div>
                <span
                  className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${
                    provider.status === 'ACTIVE'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-rose-50 text-rose-700'
                  }`}
                >
                  {provider.status}
                </span>
              </div>

              <div className="mt-4 space-y-2 text-sm text-slate-700">
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
                  <hr className="my-3 border-slate-100" />
                  <div className="space-y-1.5 text-sm text-slate-700">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Ürünler</span>
                      <span className="font-semibold text-slate-900">
                        {provider.productCounts.total.toLocaleString('tr-TR')}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="shrink-0 text-slate-500">Eşleşen</span>
                      <div className="flex flex-1 items-center justify-end gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-emerald-500"
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
                        <span className="font-semibold text-slate-900">
                          {provider.productCounts.approved.toLocaleString('tr-TR')}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Kuyruk</span>
                      <span className="font-semibold text-amber-700">
                        {provider.productCounts.queue.toLocaleString('tr-TR')}
                      </span>
                    </div>
                    {provider.productCounts.ignored > 0 ? (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Yoksayılan</span>
                        <span className="font-semibold text-slate-500">
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
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
                >
                  <Link2 size={14} />
                  Sağlayıcı Detayı
                </Link>
                <Link
                  href={`/admin/suppliers/mappings?provider=${provider.code}&tab=products`}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                >
                  <RefreshCw size={14} />
                  Mapping
                </Link>
              </div>
            </article>
          ))}

          {providers.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
              Tedarikçi kaydı bulunamadı.
            </div>
          )}
        </div>

        <AdminSurface className="p-4">
          <Link
            href="/admin/suppliers/mappings?provider=dinamik&tab=products"
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900"
          >
            Eşleştirme kuyruğunu aç
            <ArrowRight size={14} />
          </Link>
        </AdminSurface>
      </AdminPageShell>
    </AdminLayout>
  )
}
