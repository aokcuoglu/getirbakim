import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { SupplierRefreshAll } from "@/components/admin/supplier-refresh-all";
import { SupplierHealthStatus } from "@/components/admin/supplier-health-status";
import { SupplierTabs } from "@/components/admin/supplier-tabs";
import { SupplierBrowser } from "@/components/admin/supplier-browser";
import Link from "next/link";
import { Search } from "lucide-react";
import { AdminPage, AdminPageHeader, AdminPanel, StatusBadge, StatusMessage } from "@/components/admin/ui";
import { adminBasbugData } from "@/modules/admin/basbug";
import { refreshBasbug, saveBasbugCheckoutMode } from "./actions";
import { supplierCheckoutMode } from "@/modules/store/supplier-checkout-policy";
import { money } from "@/modules/store/catalog";
import { PurchaseForm } from "@/components/purchase-form";
import { SupplierRefreshButton } from "@/components/admin/supplier-refresh-button";

const number = (value: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 6 }).format(value);
// Remove only insignificant trailing zeroes; preserve the source precision.
const rate = (value: string) => value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
const date = (value: Date) => value.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });
const errors: Record<string, string> = {
  rejected: "Ürün sayısı veya veri eksikliği güvenlik eşiğini aştı. Çekim inceleme için reddedildi; güncel veriler korunuyor.",
  paused: "Başbuğ API çekimleri durduruldu. Mevcut veriler korunuyor.",
  busy: "Bir aktarım zaten devam ediyor. Biraz sonra yeniden deneyin.",
  config: "Başbuğ bağlantı bilgilerini kontrol edin.",
  contract: "İstek veya yanıt beklenen veri yapısına uymadı. Önceki veriler korunuyor.",
  upstream: "Başbuğ verileri alınamadı. Önceki veriler korunuyor; yeniden deneyebilirsiniz.",
  mode: "Sipariş veri kaynağını kontrol edin.",
};

function runError(reason: string) {
  if (reason === "product-drop-over-20-percent") return "Ürün sayısı %20’den fazla azaldı; inceleme gerekli";
  if (reason === "missing-prices-increased-over-10-points") return "Eksik fiyat oranı 10 puandan fazla arttı; inceleme gerekli";
  if (reason === "missing-stocks-increased-over-10-points") return "Eksik stok oranı 10 puandan fazla arttı; inceleme gerekli";
  if (reason === "worker-interrupted") return "İşlem tamamlanmadan kesildi";
  if (reason.startsWith("config")) return "Bağlantı ayarları eksik veya geçersiz";
  if (reason.startsWith("contract")) return "Yanıt veri yapısı doğrulanamadı";
  if (reason.startsWith("upstream:")) {
    const stage = reason.split(":")[1]?.trim();
    const service = ({ Auth: "Oturum açma", ListeGrubuGetir: "Grup listesi", MalzemeleriGetir: "Ürün listesi", FiyatGetir: "Fiyat", StokGetir: "Stok", DovizBilgisiGetir: "Kur" } as Record<string, string>)[stage];
    if (service) return `${service} servisi: ${reason.endsWith(": timeout") ? "yanıt zaman aşımına uğradı" : reason.match(/HTTP \d{3}$/)?.[0] || "veri alınamadı"}`;
  }
  return "Servis veya kayıt işlemi tamamlanamadı";
}

export default async function BasbugAdmin({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = normalizeSearchParams(await searchParams);
  const data = await adminBasbugData(params);
  const checkoutMode = await supplierCheckoutMode();
  const { snapshot, group, knownGroups, items, brands, currencies, total, page, pages } = data;
  function pageUrl(target: number) {
    const query = new URLSearchParams({ group, page: String(target) });
    for (const key of ["q", "brand", "currency", "stock", "quality", "presence"] as const) if (params[key]) query.set(key, params[key]!);
    return `/yonetim/tedarikciler/basbug?${query}`;
  }
  const mrkScopes = data.health.scopes.filter(scope => scope.warehouse === "MRK");
  const lastCommerce = mrkScopes.map(scope => scope.commerce_last_success_at).filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0];
  const runStatus = (status: string) => <span className={`supplier-run-status ${["running","succeeded","failed","rejected"].includes(status) ? status : "idle"}`}>{({running:"Çalışıyor",succeeded:"Başarılı",failed:"Başarısız",rejected:"İnceleme gerekli"} as Record<string,string>)[status] || status}</span>;
  return <AdminPage className="supplier-admin">
    <AdminPageHeader breadcrumbs={[{ label: "Yönetim", href: "/yonetim" }, { label: "Tedarikçiler", href: "/yonetim/tedarikciler" }, { label: "Başbuğ" }]} title="Başbuğ API"
      description="Ürün, kaynak fiyat ve depo stok verilerini incele; senkronizasyonu yönet." actions={<StatusBadge tone={data.health.healthy ? "success" : "warning"}>{data.health.healthy ? "Senkronizasyon sağlıklı" : "Dikkat gerekiyor"}</StatusBadge>}/>
    {params.updated === "1" && <StatusMessage>Veriler API’den çekildi ve güncel kayıtlar yenilendi.</StatusMessage>}
    {params.error && <StatusMessage tone="error">{errors[params.error] || errors.upstream}</StatusMessage>}
    {params.modeSaved === "1" && <StatusMessage>Sipariş veri kaynağı kaydedildi.</StatusMessage>}
    <section className="admin-panel" aria-label="Başbuğ özet">
      <dl className="admin-facts">
        <div><dt>Zamanlayıcı</dt><dd>{data.health.heartbeat?.alive ? "Çalışıyor" : "Sinyal yok"}<small>Son kontrol: {data.health.heartbeat?.finished_at ? date(data.health.heartbeat.finished_at) : "henüz yok"}</small></dd></div>
        <div><dt>Son fiyat · stok · kur</dt><dd>{lastCommerce ? date(lastCommerce) : "Henüz yok"}<small>{mrkScopes.length} grup otomatik izleniyor</small></dd></div>
        <div><dt>Son tam aktarım</dt><dd>{snapshot ? date(snapshot.completed_at) : "Henüz yok"}<small>{snapshot ? `${snapshot.list_group} · ${number(snapshot.quality.uniqueProducts)} ürün` : "Grup seçilmedi"}</small></dd></div>
        <div><dt>Sipariş veri kaynağı</dt><dd>{checkoutMode === "snapshot" ? "Kayıtlı veriler" : "Canlı API"}<small>{checkoutMode === "snapshot" ? "Sipariş fiyat/stok teyidi bekler" : "Siparişte API doğrulaması"}</small></dd></div>
      </dl>
    </section>
    <SupplierHealthStatus health={data.health} group={group} refresh={refreshBasbug}/>
    <SupplierTabs key={params.error ? `error-${params.error}` : params.updated ? `updated-${params.updated}` : "workspace"} initialTab={params.error ? "transfer" : "products"} transfer={<div className="admin-stack">
      <AdminPanel title="Kaynağı güncelle" description="Başbuğ API’sinden çekilecek grubu seç. Bu seçim ürün filtrelerinden bağımsızdır." actions={<span className="supplier-chip">API · MRK deposu</span>}>
        <form action={refreshBasbug} className="supplier-refresh-form"><label>Çekilecek liste grubu<select name="group" defaultValue={group || "FIAT"}>{knownGroups.map(g => <option key={g.kod} value={g.kod}>{g.ad} ({g.kod})</option>)}</select></label><SupplierRefreshButton/></form>
        <p className="admin-hint" style={{ marginTop: 10 }}>Depo: MRK · Güncelleme seçilen grubu kapsar. NF, KDV hariç maliyettir; satış fiyatı döviz kuru, yönetilebilir kâr ve KDV ile hesaplanır. Stok sinyalleri adet değildir.</p>
        <SupplierRefreshAll groups={knownGroups.map(group => group.kod)}/>
      </AdminPanel>
      <AdminPanel title="Sepet ve sipariş" description={checkoutMode === "snapshot" ? "Kayıtlı fiyat, kur ve stok verileri kullanılıyor. Siparişte API çağrısı yapılmaz; kayıtlar stok ve fiyat teyidi bekler." : "Sipariş sırasında Başbuğ API’sinden fiyat ve stok doğrulanır. Güncellik sınırını aşan kayıtlar satışa kapanır."}
        actions={<><Link className="admin-link" href="/sepet">Sepet →</Link><Link className="admin-link" href="/yonetim/siparisler">Siparişler →</Link></>}>
        <form action={saveBasbugCheckoutMode} className="supplier-refresh-form"><label>Sipariş veri kaynağı<select name="checkoutMode" defaultValue={checkoutMode}><option value="snapshot">Kayıtlı veriler · Bakım süresince</option><option value="live">Canlı API doğrulaması</option></select></label><button>Kaydet</button></form>
      </AdminPanel>
      <AdminPanel title="Otomatik güncelleme planı" description={`${data.sync?.enabled ? "Periyodik çekim etkin" : "Periyodik çekim kapalı"} · ${data.sync ? `Sonraki deneme: ${date(data.sync.next_run_at)}` : "Zamanlama kaydı bulunmuyor"} · ${group || "Tüm liste grupları"} · İstanbul saati`}>
        <div className="admin-table-region" role="region" aria-label="Otomatik güncelleme planı" tabIndex={0}><table className="admin-table"><thead><tr><th>Grup</th><th>Ürün listesi</th><th>Fiyat · stok · kur</th><th>Son ticari güncelleme</th><th>Durum</th></tr></thead><tbody>{data.health.scopes.filter(scope => !group || scope.list_group===group).map(scope => <tr key={`${scope.company}-${scope.list_group}-${scope.warehouse}`}><td><strong>{scope.list_group}</strong></td><td>{scope.enabled ? `${scope.interval_minutes} dakikada bir` : "Kapalı"}</td><td>{scope.commerce_enabled ? `${scope.commerce_interval_minutes} dakikada bir` : "Kapalı"}</td><td className="nowrap">{scope.commerce_last_success_at ? date(scope.commerce_last_success_at) : "Henüz yok"}</td><td><StatusBadge tone={scope.catalog_stale || scope.commerce_stale ? "error" : scope.commerce_failures || scope.consecutive_failures ? "warning" : "success"}>{scope.catalog_stale || scope.commerce_stale ? "Güncellik aşıldı" : scope.commerce_failures || scope.consecutive_failures ? "Yeniden deneme bekliyor" : "Güncel"}</StatusBadge></td></tr>)}</tbody></table>{!data.health.scopes.length && <p className="supplier-log-empty">Otomatik güncelleme kapsamı tanımlı değil.</p>}</div>
      </AdminPanel>
      <AdminPanel title="Çekim geçmişi" description={`Son ${data.recentRuns.length} işlem · Periyodik çekim için zamanlayıcı komutunun sunucuda çalışması gerekir.`}>
        <div className="admin-table-region" role="region" aria-label="Başbuğ veri çekim geçmişi" tabIndex={0}><table className="admin-table supplier-runs"><caption className="sr-only">Başbuğ veri çekim geçmişi</caption><thead><tr><th>Başlangıç</th><th>Kapsam</th><th>Durum</th><th className="num">Süre</th><th>Sonuç</th></tr></thead><tbody>{data.recentRuns.map(run => <tr key={run.id}>
          <td className="nowrap"><time dateTime={run.started_at.toISOString()}>{date(run.started_at)}</time><small title={run.id}><code>#{run.id.slice(0,8)}</code></small></td>
          <td><strong>{run.list_group}</strong><small>{run.run_kind === "commerce" ? "Fiyat · stok · kur" : "Tam ürün listesi"} · {run.warehouse}</small></td>
          <td>{runStatus(run.status)}</td>
          <td className="num">{run.completed_at ? `${number(Math.max(0,(run.completed_at.getTime()-run.started_at.getTime())/1000))} sn` : "Devam ediyor"}</td>
          <td>{run.status === "succeeded" ? <div className="supplier-run-counts"><span><b>{number(run.stats.added ?? 0)}</b> yeni</span><span><b>{number(run.stats.changed ?? 0)}</b> değişen</span><span><b>{number(run.stats.unchanged ?? 0)}</b> aynı</span><span><b>{number(run.stats.missing ?? 0)}</b> kayıp</span><span><b>{number(run.stats.inactive ?? 0)}</b> pasif</span><span><b>{number(run.stats.restored ?? 0)}</b> geri gelen</span></div> : run.error_reason ? runError(run.error_reason) : "İşlem sürüyor"}{run.review_note && <small>İnceleme notu: {run.review_note}</small>}</td>
        </tr>)}</tbody></table>{!data.recentRuns.length && <p className="supplier-log-empty">Henüz çekim kaydı bulunmuyor.</p>}</div>
      </AdminPanel>
      {snapshot && <AdminPanel title="Veri kalitesi" description={`${snapshot.list_group} / ${snapshot.warehouse} · Son başarılı aktarım: ${date(snapshot.completed_at)} (İstanbul)`}
        footer={<span>{number(snapshot.quality.priceRows)} fiyat, {number(snapshot.quality.stockRows)} stok satırı · Eksik stok: {snapshot.quality.missingStocks} · Ürünle eşleşmeyen fiyat/stok: {snapshot.quality.orphanPrices}/{snapshot.quality.orphanStocks}</span>}>
        <div className="supplier-summary">
          <article><small>Aktarımdaki farklı ürün</small><strong>{number(snapshot.quality.uniqueProducts)}</strong><span>{number(snapshot.quality.productRows)} kaynak satırı</span></article>
          <article><small>Eksik fiyat</small><strong>{number(snapshot.quality.missingPrices)}</strong><Link data-supplier-tab="products" href={`?${new URLSearchParams({ group: snapshot.list_group, quality: "missing-price" })}`}>Kayıtları incele →</Link></article>
          <article><small>Tekrarlanan kod</small><strong>{number(snapshot.quality.duplicateCodes)}</strong><Link data-supplier-tab="products" href={`?${new URLSearchParams({ group: snapshot.list_group, quality: "duplicates" })}`}>Kayıtları incele →</Link></article>
          <article><small>Çelişkili kod</small><strong>{number(snapshot.quality.conflictingCodes)}</strong><Link data-supplier-tab="products" href={`?${new URLSearchParams({ group: snapshot.list_group, quality: "conflicts" })}`}>Kayıtları incele →</Link></article>
        </div>
      </AdminPanel>}
      {snapshot && <AdminPanel title="Döviz kurları" description={`Kaynak API pariteleri · ${snapshot.list_group} · Çekim: ${date(snapshot.completed_at)} · Yürürlük tarihi API yanıtında bulunmuyor.`}>
        <div className="supplier-rate-grid">{snapshot.currencies_data.dovizListesi.map(c => <article className="supplier-rate-card" key={c.dovizCinsi}><strong>{c.dovizCinsi} <span>/ TRY</span></strong><dl><div><dt>Alış</dt><dd title={c.alis}>{rate(c.alis)}</dd></div><div><dt>Satış</dt><dd title={c.satis}>{rate(c.satis)}</dd></div></dl></article>)}</div>
        <details className="admin-disclosure" style={{ marginTop: 14 }}><summary>Verilerin çekilme zamanları</summary><div className="admin-table-region" style={{ marginTop: 10 }} role="region" aria-label="Kaynak veri tablosu" tabIndex={0}><table className="admin-table"><caption className="sr-only">Kaynak verilerinin çekilme zamanları</caption><thead><tr><th>Veri kaynağı</th><th>Liste / Depo</th><th>Çekilme zamanı (İstanbul)</th></tr></thead><tbody>{Object.entries(snapshot.observations).map(([key,value]) => <tr key={key}><td><strong>{({products:"Ürünler",prices:"Fiyatlar",stocks:"Stoklar",currencies:"Kurlar",groups:"Liste grupları"} as Record<string,string>)[key] || key}</strong></td><td>{snapshot.list_group} / {snapshot.warehouse}</td><td><time dateTime={new Date(value).toISOString()}>{date(new Date(value))}</time></td></tr>)}</tbody></table></div></details>
      </AdminPanel>}
    </div>} products={

    <SupplierBrowser><div className="admin-panel">
      <form key={[group,params.q,params.brand,params.currency,params.stock,params.presence,params.quality].join("|")} className="supplier-filters" action="/yonetim/tedarikciler/basbug">
      <label className="supplier-search"><span className="sr-only">Ara</span><Search size={15} aria-hidden="true"/><input name="q" defaultValue={params.q} placeholder="Parça kodu, OEM, ürün adı veya marka" maxLength={120}/></label>
      <label><span className="sr-only">Liste grubu</span><select name="group" defaultValue={group}><option value="">Tüm çekilmiş gruplar</option>{knownGroups.map(g => <option key={g.kod} value={g.kod}>{g.ad}{data.snapshots.some(s => s.list_group === g.kod) ? " · Verisi hazır" : " · Henüz çekilmedi"}</option>)}</select></label>
      <label><span className="sr-only">Marka</span><select name="brand" defaultValue={params.brand || ""}><option value="">Tüm markalar</option>{brands.map(b => <option key={b} value={b}>{b || "Belirtilmemiş"}</option>)}</select></label>
      <label><span className="sr-only">Para birimi</span><select name="currency" defaultValue={params.currency || ""}><option value="">Tüm para birimleri</option>{currencies.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
      <label><span className="sr-only">MRK stok sinyali</span><select name="stock" defaultValue={params.stock || ""}><option value="">MRK stok: tümü</option><option value="1">MRK stok sinyali: 1</option><option value="0">MRK stok sinyali: 0</option></select></label>
      <label><span className="sr-only">Listede bulunma</span><select name="presence" defaultValue={params.presence || "present"}><option value="present">Güncel listede var</option><option value="pending_missing">İlk kez bulunamadı</option><option value="inactive">İki çekimde bulunamadı</option><option value="all">Tüm kayıtlar</option></select></label>
      <label><span className="sr-only">Veri kalitesi</span><select name="quality" defaultValue={params.quality || ""}><option value="">Kalite: tümü</option><option value="missing-price">Fiyatı eksik</option><option value="duplicates">Tekrarlanan kod</option><option value="conflicts">Çelişkili kayıt</option></select></label>
      <button>Filtrele</button><Link className="admin-btn-ghost" href={`?group=${group}`}>Temizle</Link>
    </form>
    {!snapshot ? <div className="admin-empty"><h3>Bu grubun verileri henüz çekilmedi.</h3><p>Senkronizasyon sekmesinden liste grubunu seçip API’den çekebilirsiniz.</p></div> : <>
      <div className="supplier-results"><div className="results-heading"><span><strong>{number(total)}</strong> ürün</span><span>{group || "Tüm liste grupları"} · MRK</span></div>
      {items.length ? <div className="supplier-table-wrap" role="region" aria-label="Başbuğ ürün tablosu" tabIndex={0}><table className="supplier-table"><caption className="sr-only">Başbuğ ürünleri ve kaynak fiyat/stok alanları</caption><thead><tr><th>Parça / OEM</th><th>Ürün / Marka</th><th>Para birimi</th><th>LF</th><th>NF</th><th>MIF</th><th>K</th><th title="Stok sinyalleri adet değildir">MRK sinyali</th><th>Kontrol</th><th>Satış · KDV dahil</th></tr></thead><tbody>{items.map(item => <tr key={item.id}>
        <td><Link className="supplier-code" href={`/yonetim/tedarikciler/basbug/urun/${item.id}`}>{item.code}</Link><small>OEM: {item.product_data.oe || "—"}</small></td>
        <td><strong>{item.product_data.ac}</strong><small>{item.product_data.uk} · {item.product_data.ac2}</small></td>
        <td>{item.product_data.dc}</td><td>{number(item.product_data.lf)}</td><td>{item.price_data ? number(item.price_data.nf) : "Eksik"}</td><td>{item.price_data ? number(item.price_data.mif) : "Eksik"}</td><td>{item.price_data?.k ?? "—"}</td><td className="nowrap" title="Kaynak stok sinyali; adet doğrulanmadı"><StatusBadge tone={item.stock_data ? (Number(item.stock_data.stok) > 0 ? "success" : "neutral") : "warning"}>{item.stock_data ? `Sinyal ${item.stock_data.stok}` : "Eksik"}</StatusBadge></td>
        <td className="nowrap">{item.presence !== "present" ? <StatusBadge tone="warning">{item.presence === "inactive" ? "Pasif" : "Listede yok"}</StatusBadge> : item.conflicting ? <StatusBadge tone="error">Çelişkili</StatusBadge> : !item.price_data ? <StatusBadge tone="warning">Fiyat eksik</StatusBadge> : item.product_count > 1 || item.price_count > 1 || item.stock_count > 1 ? <StatusBadge tone="info">Tekrar var</StatusBadge> : <span className="supplier-muted">—</span>}<small><Link href={`/yonetim/tedarikciler/basbug/urun/${item.id}`}>Detay →</Link></small></td>
        <td className="supplier-purchase-cell"><strong>{item.sale_price_kurus ? money(item.sale_price_kurus) : "Satışa kapalı"}</strong><small>{item.sale_stock_label}</small><PurchaseForm productId={item.id} name={item.product_data.ac} available={Boolean(item.sale_available && item.sale_price_kurus)} maxQuantity={99} className="supplier-purchase"/></td>
      </tr>)}</tbody></table></div> : <div className="admin-empty"><h3>Filtrelere uygun ürün bulunamadı.</h3><p>Aramayı veya filtreleri değiştirebilirsiniz.</p></div>}
      <nav className="supplier-pagination" aria-label="Ürün sayfaları"><span className="supplier-page-info">Sayfa {number(page)} / {number(pages)}</span><div><Link aria-disabled={page === 1} href={pageUrl(Math.max(1,page-1))}>← Önceki</Link>{Array.from(new Set([1, ...Array.from({length:5},(_,i)=>Math.max(1,Math.min(page-2,pages-4))+i),pages])).filter(n=>n>=1&&n<=pages).sort((a,b)=>a-b).map((n,i,ns)=><span key={n}>{i>0 && n-ns[i-1]>1 && <span className="pagination-gap">…</span>}<Link aria-current={n===page ? "page" : undefined} href={pageUrl(n)}>{n}</Link></span>)}<Link aria-disabled={page === pages} href={pageUrl(Math.min(pages,page+1))}>Sonraki →</Link></div><form action="/yonetim/tedarikciler/basbug">{Object.entries(params).filter(([key])=>!["page","updated","error"].includes(key)).map(([key,value])=><input key={key} type="hidden" name={key} value={value || ""}/>)}<label>Sayfaya git<input aria-label="Sayfa numarası" type="number" name="page" min={1} max={pages} defaultValue={page}/></label><button className="admin-btn-secondary">Git</button></form></nav></div>
    </>}</div></SupplierBrowser>
    }/>
  </AdminPage>;
}
