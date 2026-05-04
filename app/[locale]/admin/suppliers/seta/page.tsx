import { AlertTriangle, DatabaseZap, GitMerge, PackageSearch } from 'lucide-react'
import { notFound } from 'next/navigation'
import type { ElementType } from 'react'
import { AdminLayout } from '@/components/admin/admin-layout'
import {
  AdminPageHeader,
  AdminPageShell,
  AdminSurface
} from '@/components/admin/admin-page-shell'
import { Link } from '@/lib/navigation'
import { getAdminSupplierProviderDetail } from '@/lib/actions/admin-suppliers'
import { SetaControls } from '../_components/SetaControls'

export default async function AdminSetaSupplierPage() {
  const result = await getAdminSupplierProviderDetail('seta')

  if (!result.success || !result.data) {
    notFound()
  }

  const detail = result.data

  return (
    <AdminLayout>
      <AdminPageShell>
        <AdminPageHeader
          title="SETA Sağlayıcı Yönetimi"
          description="SETA provider metrikleri, run geçmişi ve mapping geçişini bu ekrandan yönetin."
          eyebrow="SETA Provider"
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Staging Ürün" value={detail.counts.productCount} icon={PackageSearch} />
          <MetricCard label="Aktif Teklif" value={detail.counts.offerCount} icon={DatabaseZap} />
          <MetricCard label="Mapping Kuyruğu" value={detail.counts.queueCount} icon={GitMerge} />
          <MetricCard label="Ignore" value={detail.counts.ignoredCount} icon={AlertTriangle} />
        </div>

        <SetaControls provider={detail.provider} />

        <AdminSurface className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">SETA Eşleştirme Operasyonu</h2>
              <p className="mt-1 text-xs text-slate-500">
                Ürün mapping ve manuel OEM girişleri için ürün listesine geçin.
              </p>
            </div>
            <Link
              href="/admin/suppliers/mappings?provider=seta&tab=products"
              className="inline-flex items-center rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Mapping Ekranına Git
            </Link>
          </div>
        </AdminSurface>

        <AdminSurface className="p-4">
          <h2 className="text-sm font-semibold text-slate-900">Son Senkron Çalışmaları</h2>
          <div className="mt-3 space-y-3 md:hidden">
            {detail.runs.length === 0 ? (
              <div className="rounded-xl border border-slate-200 px-3 py-6 text-center text-sm text-slate-500">
                Henüz senkron kaydı yok.
              </div>
            ) : (
              detail.runs.map((run) => (
                <article key={run.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-slate-900">#{run.id}</p>
                    <p className="text-xs text-slate-600">{run.status}</p>
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-slate-600">
                    <p>Tetik: {run.triggerType}</p>
                    <p>
                      Başlangıç:{' '}
                      {run.startedAt
                        ? new Date(run.startedAt).toLocaleString('tr-TR')
                        : '-'}
                    </p>
                    <p>Kayıt: {run.totalCount}</p>
                    <p>Başarısız: {run.failedCount}</p>
                    <p className="line-clamp-2">Hata: {run.errorSummary || '-'}</p>
                  </div>
                </article>
              ))
            )}
          </div>
          <div className="mt-3 hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="px-2 py-2">Run ID</th>
                  <th className="px-2 py-2">Tetik</th>
                  <th className="px-2 py-2">Durum</th>
                  <th className="px-2 py-2">Başlangıç</th>
                  <th className="px-2 py-2">Kayıt</th>
                  <th className="px-2 py-2">Başarısız</th>
                  <th className="px-2 py-2">Hata</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detail.runs.map((run) => (
                  <tr key={run.id}>
                    <td className="px-2 py-2 font-semibold">#{run.id}</td>
                    <td className="px-2 py-2">{run.triggerType}</td>
                    <td className="px-2 py-2">{run.status}</td>
                    <td className="px-2 py-2">
                      {run.startedAt
                        ? new Date(run.startedAt).toLocaleString('tr-TR')
                        : '-'}
                    </td>
                    <td className="px-2 py-2">{run.totalCount}</td>
                    <td className="px-2 py-2">{run.failedCount}</td>
                    <td className="px-2 py-2 text-xs text-slate-600">
                      {run.errorSummary || '-'}
                    </td>
                  </tr>
                ))}
                {detail.runs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-2 py-8 text-center text-slate-500">
                      Henüz senkron kaydı yok.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </AdminSurface>
      </AdminPageShell>
    </AdminLayout>
  )
}

function MetricCard({
  label,
  value,
  icon: Icon
}: {
  label: string
  value: number
  icon: ElementType
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
        <Icon size={14} className="text-slate-500" />
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value.toLocaleString('tr-TR')}</p>
    </div>
  )
}
