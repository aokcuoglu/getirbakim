import type { supplierHealth } from "@/modules/suppliers/health";
import { SupplierRefreshButton } from "./supplier-refresh-button";

type Health = Awaited<ReturnType<typeof supplierHealth>>;
const date = (value: Date | null) => value ? value.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }) : "Henüz başarılı çekim yok";

export function SupplierHealthStatus({ health, group, refresh }: {
  health: Health; group: string; refresh: (form: FormData) => Promise<void>;
}) {
  const scopes = health.scopes.filter(scope => scope.supplier === "basbug" && scope.warehouse === "MRK" && (!group || scope.list_group === group));
  const affected = scopes.filter(scope => scope.catalog_stale || scope.commerce_stale || scope.consecutive_failures > 0 || scope.commerce_failures > 0);
  const schedulerAlive = Boolean(health.heartbeat?.alive);
  if (!affected.length && schedulerAlive) return null;
  const commerceStale = affected.filter(scope => scope.commerce_stale).length;
  const catalogStale = affected.filter(scope => scope.catalog_stale).length;
  const retries = affected.flatMap(scope => [
    ...(scope.enabled && (scope.catalog_stale || scope.consecutive_failures) ? [scope.next_run_at] : []),
    ...(scope.commerce_enabled && (scope.commerce_stale || scope.commerce_failures) ? [scope.commerce_next_run_at] : []),
  ]);
  const nextRetry = retries.sort((a, b) => a.getTime() - b.getTime())[0];
  return <section className="supplier-health-status" aria-labelledby="supplier-health-title">
    <div role="status">
      <h2 id="supplier-health-title">{commerceStale || catalogStale ? "Başbuğ verilerinin güncellenmesi gerekiyor" : affected.length ? "Başbuğ güncellemeleri yeniden deneme bekliyor" : "Otomatik güncelleme sinyali alınamıyor"}</h2>
      <p>{affected.length > 0 ? `${affected.length} grupta güncelleme sorunu var. Son başarılı veriler gösteriliyor.` : "Zamanlayıcının çalıştığını ve bilgisayarın açık olduğunu kontrol edin."}</p>
      {(commerceStale > 0 || catalogStale > 0) && <p>{commerceStale > 0 && `Fiyat · stok · kur: ${commerceStale} grupta güncellik süresi aşıldı. `}{catalogStale > 0 && `Ürün listesi: ${catalogStale} grupta güncellik süresi aşıldı.`}</p>}
      <p>Zamanlayıcı: {schedulerAlive ? "Çalışma sinyali güncel" : "Çalışma sinyali yok"} · {nextRetry ? `${schedulerAlive ? "Sonraki deneme" : "Planlanan deneme"}: ${date(nextRetry)}${nextRetry.getTime() <= health.checked_at.getTime() ? " (çalıştırılması bekleniyor)" : ""}` : "Güncel zamanlama kaydı yok"} · İstanbul saati</p>
    </div>
    <details className="supplier-health-details">
      <summary>Ayrıntıları gör{affected.length > 0 && ` · ${affected.map(scope => scope.list_group).join(", ")}`}</summary>
      <div className="supplier-log-wrap" role="region" aria-label="Grup bazında güncellik ve yeniden denemeler" tabIndex={0}>
        <table className="supplier-log-table"><caption className="sr-only">Başbuğ güncelleme durumu · İstanbul saati</caption>
          <thead><tr><th>Grup</th><th>Ürün listesi</th><th>Fiyat · stok · kur</th><th>Sonraki denemeler</th></tr></thead>
          <tbody>{(affected.length ? affected : scopes).map(scope => <tr key={`${scope.company}-${scope.list_group}-${scope.warehouse}`}>
            <td><strong>{scope.list_group}</strong></td>
            <td>{!scope.enabled ? "Otomatik çekim kapalı" : scope.catalog_stale ? "Güncellik süresi aşıldı" : "Güncellik süresi içinde"}<small>Son başarı: {date(scope.last_success_at)}</small>{scope.consecutive_failures > 0 && <small>Art arda {scope.consecutive_failures} başarısız çekim</small>}</td>
            <td>{!scope.commerce_enabled ? "Otomatik çekim kapalı" : scope.commerce_stale ? "Güncellik süresi aşıldı" : "Güncellik süresi içinde"}<small>Son başarı: {date(scope.commerce_last_success_at)}</small>{scope.commerce_failures > 0 && <small>Art arda {scope.commerce_failures} başarısız çekim</small>}</td>
            <td>{scope.enabled && <small>Ürün: {date(scope.next_run_at)}</small>}{scope.commerce_enabled && <small>Fiyat/stok/kur: {date(scope.commerce_next_run_at)}</small>}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>
    {(affected.length > 0 || scopes.length > 0) && <form action={refresh} className="supplier-health-retry">
      <label>Yeniden denenecek grup<select name="group" defaultValue={group || affected[0]?.list_group || scopes[0]?.list_group}>{(affected.length ? affected : scopes).map(scope => <option key={scope.list_group} value={scope.list_group}>{scope.list_group}</option>)}</select></label>
      <SupplierRefreshButton label="Seçili grubu yeniden dene"/>
      <span>Ürün, fiyat, MRK stok ve kur verileri birlikte yenilenir.</span>
    </form>}
  </section>;
}
