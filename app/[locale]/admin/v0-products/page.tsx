import { AdminPageHeader, AdminPageShell, AdminSurface } from '@/components/admin/admin-page-shell'
import { getAdminBreadcrumbs } from '@/lib/admin/breadcrumbs'
import { getV0ProductEnrichmentStats } from '@/lib/admin/v0-product-enrichment-stats'
import { Badge } from '@/components/ui/badge'

function StatCard({
  label,
  value,
  hint
}: {
  label: string
  value: number
  hint?: string
}) {
  return (
    <AdminSurface className="p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">
        {value.toLocaleString('tr-TR')}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </AdminSurface>
  )
}

export default async function AdminV0ProductsPage() {
  const stats = await getV0ProductEnrichmentStats()

  return (
    <AdminPageShell width="wide">
      <AdminPageHeader
        title="V0 Ürün Zenginleştirme"
        description="Dinamik, Başbuğ ve ParçaTedarik kaynaklarından oluşan ticari ürün master, kod sinyalleri ve public.parts bağlantıları."
        breadcrumbs={getAdminBreadcrumbs('/admin/v0-products')}
      />

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="V0 Ürün" value={stats.productCount} />
        <StatCard label="Kaynak Bağı" value={stats.sourceCount} />
        <StatCard label="Kod Sinyali" value={stats.codeSignalCount} />
        <StatCard label="Parts Link" value={stats.publicPartLinkCount} />
        <StatCard
          label="Onaylı Link"
          value={stats.approvedPublicPartLinkCount}
          hint="Detay sayfası enrichment kullanır"
        />
        <StatCard
          label="Aday Link"
          value={stats.candidatePublicPartLinkCount}
          hint="Admin onayı gerekir"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <AdminSurface className="p-4">
          <h2 className="text-base font-semibold text-foreground">Kaynak Dağılımı</h2>
          <div className="mt-4 space-y-2">
            {stats.sourceCounts.length > 0 ? (
              stats.sourceCounts.map((item) => (
                <div
                  key={item.sourceType}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                >
                  <Badge variant="outline">{item.sourceType}</Badge>
                  <span className="font-medium">{item.count.toLocaleString('tr-TR')}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Henüz kaynak bağı yok.</p>
            )}
          </div>
        </AdminSurface>

        <AdminSurface className="p-4">
          <h2 className="text-base font-semibold text-foreground">Kod Sinyali Türleri</h2>
          <div className="mt-4 space-y-2">
            {stats.codeKindCounts.length > 0 ? (
              stats.codeKindCounts.map((item) => (
                <div
                  key={item.codeKind}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                >
                  <Badge variant="outline">{item.codeKind}</Badge>
                  <span className="font-medium">{item.count.toLocaleString('tr-TR')}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Henüz kod sinyali yok.</p>
            )}
          </div>
        </AdminSurface>
      </div>

      <AdminSurface className="overflow-hidden">
        <div className="border-b border-border p-4">
          <h2 className="text-base font-semibold text-foreground">Son V0 Ürünler</h2>
          <p className="text-sm text-muted-foreground">
            Backfill ilerledikçe burada master ürün, kaynak ve public.parts bağlantı sayıları görünür.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Ürün</th>
                <th className="px-4 py-3">Marka</th>
                <th className="px-4 py-3">Kaynak</th>
                <th className="px-4 py-3">Kod</th>
                <th className="px-4 py-3">Parts Link</th>
                <th className="px-4 py-3">Onaylı Part</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentProducts.map((product) => (
                <tr key={product.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium">{product.id}</td>
                  <td className="max-w-md px-4 py-3">{product.displayName}</td>
                  <td className="px-4 py-3">{product.brandName || '-'}</td>
                  <td className="px-4 py-3">{product.sourceCount}</td>
                  <td className="px-4 py-3">{product.codeSignalCount}</td>
                  <td className="px-4 py-3">{product.publicPartLinkCount}</td>
                  <td className="px-4 py-3">{product.approvedPartId || '-'}</td>
                </tr>
              ))}
              {stats.recentProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    Henüz v0 ürün kaydı yok. `APPLY=true bun scripts/backfill-v0-products-enrichment.ts` çalıştırın.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </AdminSurface>
    </AdminPageShell>
  )
}
