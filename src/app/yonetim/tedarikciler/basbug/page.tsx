import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { SupplierRefreshAll } from "@/components/admin/supplier-refresh-all";
import { SupplierHealthStatus } from "@/components/admin/supplier-health-status";
import { SupplierTabs } from "@/components/admin/supplier-tabs";
import { SupplierBrowser } from "@/components/admin/supplier-browser";
import Link from "next/link";
import { AdminPageHeader, StatusBadge } from "@/components/admin/ui";
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
  return <section className="shell page-section supplier-admin">
    <AdminPageHeader breadcrumbs={[{ label: "Yönetim", href: "/yonetim" }, { label: "Tedarikçiler", href: "/yonetim/tedarikciler" }, { label: "Başbuğ" }]} eyebrow="Tedarikçi verileri" title="Başbuğ" description="Ürün, kaynak fiyat ve depo stok verilerini incele." actions={<StatusBadge tone="info">Başbuğ API · MRK</StatusBadge>}/>
    {params.updated === "1" && <p className="notice" role="status">Veriler API’den çekildi ve güncel kayıtlar yenilendi.</p>}
    {params.error && <p className="error" role="alert">{errors[params.error] || errors.upstream}</p>}
    {params.modeSaved === "1" && <p className="notice" role="status">Sipariş veri kaynağı kaydedildi.</p>}
    <section className="panel supplier-commerce-mode" aria-labelledby="supplier-commerce-title">
      <div><h2 id="supplier-commerce-title">Sepet ve sipariş</h2><p>{checkoutMode === "snapshot" ? "Kayıtlı fiyat, kur ve stok verileri kullanılıyor. Siparişte API çağrısı yapılmaz; kayıtlar stok ve fiyat teyidi bekler." : "Sipariş sırasında Başbuğ API’sinden fiyat ve stok doğrulanır. Güncellik sınırını aşan kayıtlar satışa kapanır."}</p><Link href="/sepet">Sepeti aç →</Link> · <Link href="/yonetim/siparisler">Siparişleri yönet →</Link></div>
      <form action={saveBasbugCheckoutMode}><label>Sipariş veri kaynağı<select name="checkoutMode" defaultValue={checkoutMode}><option value="snapshot">Kayıtlı veriler · Bakım süresince</option><option value="live">Canlı API doğrulaması</option></select></label><button>Kaydet</button></form>
    </section>
    <SupplierHealthStatus health={data.health} group={group} refresh={refreshBasbug}/>
    <SupplierRefreshAll groups={knownGroups.map(group => group.kod)}/>
    <SupplierTabs key={params.error ? `error-${params.error}` : params.updated ? `updated-${params.updated}` : "workspace"} initialTab={params.error ? "transfer" : "products"} transfer={<>
    <section className="supplier-import-section"><div className="supplier-section-title"><div><h2>Kaynağı güncelle</h2><p>Başbuğ API’sinden çekilecek grubu seç. Bu seçim ürün filtrelerinden bağımsızdır.</p></div><span className="supplier-chip">API · MRK deposu</span></div>    <details className="panel supplier-run-history"><summary>Senkronizasyon ve çekim geçmişi <span>Son {data.recentRuns.length} işlem</span></summary>
      <div className="supplier-sync-overview"><span>Zamanlayıcı: {data.health.heartbeat?.alive ? "Çalışıyor" : "Çalışma sinyali yok"}</span><span>Son kontrol: {data.health.heartbeat?.finished_at ? date(data.health.heartbeat.finished_at) : "Henüz tamamlanmadı"}</span></div>
      <div className="supplier-log-wrap"><table className="supplier-log-table"><caption>Otomatik güncelleme planı</caption><thead><tr><th>Grup</th><th>Ürün listesi</th><th>Fiyat · stok · kur</th><th>Son ticari güncelleme</th><th>Durum</th></tr></thead><tbody>{data.health.scopes.filter(scope => !group || scope.list_group===group).map(scope => <tr key={`${scope.company}-${scope.list_group}-${scope.warehouse}`}><td>{scope.list_group}</td><td>{scope.enabled ? `${scope.interval_minutes} dakikada bir` : "Kapalı"}</td><td>{scope.commerce_enabled ? `${scope.commerce_interval_minutes} dakikada bir` : "Kapalı"}</td><td>{scope.commerce_last_success_at ? date(scope.commerce_last_success_at) : "Henüz yok"}</td><td>{scope.catalog_stale || scope.commerce_stale ? "Güncellik süresi aşıldı" : scope.commerce_failures || scope.consecutive_failures ? "Yeniden deneme bekleniyor" : "Güncel"}</td></tr>)}</tbody></table></div>
      <div className="supplier-sync-overview"><span className={`supplier-run-status ${data.sync?.enabled ? "succeeded" : "idle"}`}>{data.sync?.enabled ? "Periyodik çekim etkin" : "Periyodik çekim kapalı"}</span><span>{data.sync ? `Sonraki deneme: ${date(data.sync.next_run_at)}` : "Zamanlama kaydı bulunmuyor"}</span><span>{group || "Tüm liste grupları"} · MRK · İstanbul saati</span></div>
      <div className="supplier-log-wrap" role="region" aria-label="Kaynak veri tablosu" tabIndex={0}><table className="supplier-log-table"><caption className="sr-only">Başbuğ veri çekim geçmişi</caption><thead><tr><th>Başlangıç / İşlem</th><th>Kapsam</th><th>Durum</th><th>Süre</th><th>Sonuç</th></tr></thead><tbody>{data.recentRuns.map(run => <tr key={run.id}>
        <td><time dateTime={run.started_at.toISOString()}>{date(run.started_at)}</time><small title={run.id}>#{run.id.slice(0,8)}</small></td>
        <td><strong>{run.list_group}</strong><small>{run.run_kind === "commerce" ? "Fiyat · stok · kur" : "Tam ürün listesi"}</small><small>{run.warehouse} deposu</small></td>
        <td><span className={`supplier-run-status ${["running","succeeded","failed","rejected"].includes(run.status) ? run.status : "idle"}`}>{({running:"Çalışıyor",succeeded:"Başarılı",failed:"Başarısız",rejected:"İnceleme gerekli"} as Record<string,string>)[run.status] || run.status}</span></td>
        <td>{run.completed_at ? `${number(Math.max(0,(run.completed_at.getTime()-run.started_at.getTime())/1000))} sn` : "Devam ediyor"}{run.completed_at && <small>Bitiş: {date(run.completed_at)}</small>}</td>
        <td>{run.status === "succeeded" ? <div className="supplier-run-counts"><span><b>{number(run.stats.added ?? 0)}</b> yeni</span><span><b>{number(run.stats.changed ?? 0)}</b> değişen</span><span><b>{number(run.stats.unchanged ?? 0)}</b> aynı</span><span><b>{number(run.stats.missing ?? 0)}</b> kayıp</span><span><b>{number(run.stats.inactive ?? 0)}</b> pasif</span><span><b>{number(run.stats.restored ?? 0)}</b> geri gelen</span></div> : run.error_reason ? runError(run.error_reason) : "İşlem sürüyor"}{run.review_note && <small>İnceleme notu: {run.review_note}</small>}</td>
      </tr>)}</tbody></table>{!data.recentRuns.length && <p className="supplier-log-empty">Henüz çekim kaydı bulunmuyor.</p>}</div>
      <p className="muted">Periyodik çekim için zamanlayıcı komutunun sunucuda çalışması gerekir.</p>
    </details>
    <div className="panel supplier-refresh"><form action={refreshBasbug}><label>Çekilecek liste grubu<select name="group" defaultValue={group || "FIAT"}>{knownGroups.map(g => <option key={g.kod} value={g.kod}>{g.ad} ({g.kod})</option>)}</select></label><div><small>Depo: MRK · Güncelleme seçilen grubu kapsar.</small><SupplierRefreshButton/></div></form><p className="muted">NF, KDV hariç maliyettir. Satış fiyatı döviz kuru, yönetilebilir kâr ve KDV ile hesaplanır. Stok sinyalleri adet değildir.</p></div>
</section>
    {snapshot && <section className="supplier-rates"><div className="supplier-section-title"><div><span className="eyebrow">KAYNAK PARİTELERİ</span><h2>Döviz kurları</h2></div><span className="muted">{snapshot.list_group} · Çekim: {date(snapshot.completed_at)}</span></div><div className="supplier-rate-grid">{snapshot.currencies_data.dovizListesi.map(c => <article className="supplier-rate-card" key={c.dovizCinsi}><div><span className="supplier-flag">{({USD:"🇺🇸",EUR:"🇪🇺",GBP:"🇬🇧",CHF:"🇨🇭",CNY:"🇨🇳",JPY:"🇯🇵",RUB:"🇷🇺",TL:"🇹🇷",TRY:"🇹🇷"} as Record<string,string>)[c.dovizCinsi] || "🌐"}</span><strong>{c.dovizCinsi} <span>/ TRY</span></strong></div><dl><div><dt>Alış</dt><dd title={c.alis}>{rate(c.alis)}</dd></div><div><dt>Satış</dt><dd title={c.satis}>{rate(c.satis)}</dd></div></dl></article>)}</div><details className="supplier-observations"><summary>Verilerin çekilme zamanları</summary><div className="supplier-log-wrap" role="region" aria-label="Kaynak veri tablosu" tabIndex={0}><table className="supplier-log-table supplier-observation-table"><caption className="sr-only">Kaynak verilerinin çekilme zamanları</caption><thead><tr><th>Veri kaynağı</th><th>Liste / Depo</th><th>Çekilme zamanı (İstanbul)</th></tr></thead><tbody>{Object.entries(snapshot.observations).map(([key,value]) => <tr key={key}><td><strong>{({products:"Ürünler",prices:"Fiyatlar",stocks:"Stoklar",currencies:"Kurlar",groups:"Liste grupları"} as Record<string,string>)[key] || key}</strong></td><td>{snapshot.list_group} / {snapshot.warehouse}</td><td><time dateTime={new Date(value).toISOString()}>{date(new Date(value))}</time></td></tr>)}</tbody></table></div></details><p className="muted">Kaynak API kurlarıdır; yürürlük tarihi API yanıtında bulunmuyor.</p></section>}
    {snapshot && <section aria-label="Son başarılı aktarımın veri kalitesi">
      <p className="muted">Veri kalitesi özeti · {snapshot.list_group} · Son başarılı aktarım</p><div className="supplier-summary">
        <article className="panel"><small>Aktarımdaki farklı ürün</small><strong>{number(snapshot.quality.uniqueProducts)}</strong><span>{number(snapshot.quality.productRows)} kaynak satırı</span></article>
        <article className="panel"><small>Eksik fiyat</small><strong>{number(snapshot.quality.missingPrices)}</strong><Link data-supplier-tab="products" href={`?${new URLSearchParams({ group: snapshot.list_group, quality: "missing-price" })}`}>Kayıtları incele →</Link></article>
        <article className="panel"><small>Tekrarlanan kod</small><strong>{number(snapshot.quality.duplicateCodes)}</strong><Link data-supplier-tab="products" href={`?${new URLSearchParams({ group: snapshot.list_group, quality: "duplicates" })}`}>Kayıtları incele →</Link></article>
        <article className="panel"><small>Çelişkili kod</small><strong>{number(snapshot.quality.conflictingCodes)}</strong><Link data-supplier-tab="products" href={`?${new URLSearchParams({ group: snapshot.list_group, quality: "conflicts" })}`}>Kayıtları incele →</Link></article>
      </div>
      <p className="muted">Son başarılı aktarım: {date(snapshot.completed_at)} (İstanbul) · {snapshot.list_group} / {snapshot.warehouse} · {number(snapshot.quality.priceRows)} fiyat, {number(snapshot.quality.stockRows)} stok satırı. Eksik stok: {snapshot.quality.missingStocks}. Ürünle eşleşmeyen fiyat/stok: {snapshot.quality.orphanPrices}/{snapshot.quality.orphanStocks}.</p>

    </section>}
    </>} products={<>

    <SupplierBrowser><div className="supplier-section-title"><div><h2>Ürünleri incele</h2><p>Tüm çekilmiş gruplarda ara veya bir liste grubuna daralt.</p></div><span className="supplier-chip">{number(total)} kayıt</span></div><form key={[group,params.q,params.brand,params.currency,params.stock,params.presence,params.quality].join("|")} className="panel supplier-filters" action="/yonetim/tedarikciler/basbug">
      <label className="supplier-search">Ara<input name="q" defaultValue={params.q} placeholder="Parça kodu, OEM, ürün adı veya marka" maxLength={120}/></label>
      <label>Liste grubu<select name="group" defaultValue={group}><option value="">Tüm çekilmiş gruplar</option>{knownGroups.map(g => <option key={g.kod} value={g.kod}>{g.ad}{data.snapshots.some(s => s.list_group === g.kod) ? " · Verisi hazır" : " · Henüz çekilmedi"}</option>)}</select></label>
      <label>Marka<select name="brand" defaultValue={params.brand || ""}><option value="">Tüm markalar</option>{brands.map(b => <option key={b} value={b}>{b || "Belirtilmemiş"}</option>)}</select></label>
      <label>Para birimi<select name="currency" defaultValue={params.currency || ""}><option value="">Tümü</option>{currencies.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
      <label>MRK stok sinyali<select name="stock" defaultValue={params.stock || ""}><option value="">Tümü</option><option value="1">Kaynak değeri: 1</option><option value="0">Kaynak değeri: 0</option></select></label>
      <label>Listede bulunma<select name="presence" defaultValue={params.presence || "present"}><option value="present">Güncel listede var</option><option value="pending_missing">İlk kez bulunamadı</option><option value="inactive">İki çekimde bulunamadı</option><option value="all">Tümü</option></select></label>
      <label>Veri kalitesi<select name="quality" defaultValue={params.quality || ""}><option value="">Tüm kayıtlar</option><option value="missing-price">Fiyatı eksik</option><option value="duplicates">Tekrarlanan kod</option><option value="conflicts">Çelişkili kayıt</option></select></label>
      <button>Filtrele</button><Link href={`?group=${group}`}>Filtreleri temizle</Link>
    </form>
    {!snapshot ? <div className="empty"><h2>Bu grubun verileri henüz çekilmedi.</h2><p>Veri aktarımı sekmesinden liste grubunu seçip API’den çekebilirsiniz.</p></div> : <>
      <div className="supplier-results"><div className="results-heading"><span>{number(total)} ürün · Sayfa {page} / {pages}</span><span>{group || "Tüm liste grupları"} · MRK</span></div>
      {items.length ? <div className="supplier-table-wrap" role="region" aria-label="Başbuğ ürün tablosu" tabIndex={0}><table className="supplier-table"><caption className="sr-only">Başbuğ ürünleri ve kaynak fiyat/stok alanları</caption><thead><tr><th>Parça / OEM</th><th>Ürün / Marka</th><th>Para birimi</th><th>LF</th><th>NF</th><th>MIF</th><th>K</th><th>MRK sinyali</th><th>Kontrol</th><th>Satış · KDV dahil</th></tr></thead><tbody>{items.map(item => <tr key={item.id}>
        <td><Link className="supplier-code" href={`/yonetim/tedarikciler/basbug/urun/${item.id}`}>{item.code}</Link><small>OEM: {item.product_data.oe || "—"}</small></td>
        <td><strong>{item.product_data.ac}</strong><small>{item.product_data.uk} · {item.product_data.ac2}</small></td>
        <td>{item.product_data.dc}</td><td>{number(item.product_data.lf)}</td><td>{item.price_data ? number(item.price_data.nf) : "Eksik"}</td><td>{item.price_data ? number(item.price_data.mif) : "Eksik"}</td><td>{item.price_data?.k ?? "—"}</td><td>{item.stock_data?.stok ?? "Eksik"}<small>Adet doğrulanmadı</small></td>
        <td>{item.presence !== "present" ? (item.presence === "inactive" ? "Pasif" : "Listede bulunamadı") : item.conflicting ? "Çelişkili" : !item.price_data ? "Fiyat eksik" : item.product_count > 1 || item.price_count > 1 || item.stock_count > 1 ? "Tekrar var" : "—"}<small><Link href={`/yonetim/tedarikciler/basbug/urun/${item.id}`}>Detay →</Link></small></td>
        <td className="supplier-purchase-cell"><strong>{item.sale_price_kurus ? money(item.sale_price_kurus) : "Satışa kapalı"}</strong><small>{item.sale_stock_label}</small><PurchaseForm productId={item.id} name={item.product_data.ac} available={Boolean(item.sale_available && item.sale_price_kurus)} maxQuantity={99} className="supplier-purchase"/></td>
      </tr>)}</tbody></table></div> : <div className="empty"><h2>Filtrelere uygun ürün bulunamadı.</h2><p>Aramayı veya filtreleri değiştirebilirsiniz.</p></div>}
      <nav className="supplier-pagination" aria-label="Ürün sayfaları"><Link aria-disabled={page === 1} href={pageUrl(Math.max(1,page-1))}>← Önceki</Link><div>{Array.from(new Set([1, ...Array.from({length:5},(_,i)=>Math.max(1,Math.min(page-2,pages-4))+i),pages])).filter(n=>n>=1&&n<=pages).sort((a,b)=>a-b).map((n,i,ns)=><span key={n}>{i>0 && n-ns[i-1]>1 && <span className="pagination-gap">…</span>}<Link aria-current={n===page ? "page" : undefined} href={pageUrl(n)}>{n}</Link></span>)}</div><Link aria-disabled={page === pages} href={pageUrl(Math.min(pages,page+1))}>Sonraki →</Link><form action="/yonetim/tedarikciler/basbug">{Object.entries(params).filter(([key])=>!["page","updated","error"].includes(key)).map(([key,value])=><input key={key} type="hidden" name={key} value={value || ""}/>)}<label>Sayfaya git<input aria-label="Sayfa numarası" type="number" name="page" min={1} max={pages} defaultValue={page}/></label><button>Git</button></form></nav></div>
    </>}</SupplierBrowser>
    </>}/>
  </section>;
}
