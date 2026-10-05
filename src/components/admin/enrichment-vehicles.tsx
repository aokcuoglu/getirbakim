"use client";

import { useEffect, useId, useState } from "react";
import { CarFront, Search } from "lucide-react";
import { fitmentStatusLabels, fitmentStatusReasons, type AdminFitmentDetails } from "@/modules/admin/fitment-details";

export function EnrichmentVehicles({ productId }: { productId: string }) {
  const id = useId();
  const [data, setData] = useState<AdminFitmentDetails | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/product-fitments/${productId}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 403 ? "Oturumun sona ermiş olabilir. Yönetici hesabınla yeniden giriş yap." : "Araç bilgileri yüklenemedi.");
        return response.json() as Promise<AdminFitmentDetails>;
      }).then(setData).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Araç bilgileri yüklenemedi."); });
    return () => controller.abort();
  }, [productId, attempt]);
  const matched = data?.rows.filter(row => row.status === "matched" && row.catalog).length || 0;
  const normalize = (value: string) => value.toLocaleLowerCase("tr").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i");
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const rows = data?.rows.filter(row => {
    const linked = row.status === "matched" && row.catalog !== null;
    const haystack = normalize(`${row.source.model} ${row.source.engineAndCodes} ${row.source.ps} ${row.source.kw} ${row.source.cc} ${row.catalog?.typeId || ""} ${fitmentStatusLabels[row.status] || row.status}`);
    return (filter === "all" || (filter === "matched" ? linked : !linked)) && terms.every(term => haystack.includes(term));
  }) || [];
  return <section className="enrichment-vehicles" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}><CarFront size={18}/>Araç / motor eşleşmeleri</h3>
    {error ? <div className="enrichment-vehicle-error" role="alert"><p>{error}</p><button type="button" onClick={() => { setError(""); setAttempt(value => value + 1); }}>Tekrar dene</button></div> : !data ? <p role="status">Araç bilgileri yükleniyor…</p> : !data.rows.length ? <p className="enrichment-vehicle-empty">{data.modelCount ? `${data.modelCount} model adı kaydedilmiş; motor ayrıntıları henüz aktarılmamış.` : "Bu ürün için henüz araç / motor bilgisi aktarılmamış."}</p> : <>
      <div className="enrichment-vehicle-counts"><span><b>{data.rows.length}</b> toplam</span><span className="is-matched"><b>{matched}</b> eşleşen</span><span className="is-unmatched"><b>{data.rows.length - matched}</b> eşleşmeyen</span></div>
      <div className="enrichment-vehicle-filters"><label className="enrichment-vehicle-search"><Search size={16}/><span className="sr-only">Araç, motor veya tip kimliği ara</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Araç, motor kodu veya tip kimliği ara…"/></label><label><span className="sr-only">Araç eşleşme durumu</span><select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Tüm araçlar</option><option value="matched">Eşleşen araçlar</option><option value="unmatched">Eşleşmeyen araçlar</option></select></label></div>
      <p className="enrichment-vehicle-result" role="status">{rows.length} / {data.rows.length} satır gösteriliyor</p>
      <div className="enrichment-vehicle-table-wrap" tabIndex={0} role="region" aria-label="Araç eşleşme listesi"><table className="enrichment-vehicle-table"><thead><tr><th scope="col">Araç / motor</th><th scope="col">Teknik bilgiler</th><th scope="col">Üretim aralığı</th><th scope="col">Eşleşme sonucu</th></tr></thead><tbody>{rows.map(row => <tr key={row.index}>
        <td><strong>{row.source.model}</strong><span>{row.source.engineAndCodes}</span>{row.catalog && <small>Katalog: {row.catalog.brand} {row.catalog.model} · {row.catalog.engine}<br/>Araç tipi #{row.catalog.typeId}</small>}</td>
        <td>{row.source.ps} PS · {row.source.kw} kW{row.source.cc > 0 && <span>{row.source.cc} cm³</span>}<small>{row.source.fuel}</small></td>
        <td>{row.source.from}<span>– {row.source.to || "Bitiş belirtilmemiş"}</span></td>
        <td><span className={`enrichment-vehicle-status ${row.catalog ? "is-matched" : "is-unmatched"}`}>{fitmentStatusLabels[row.status] || row.status}</span>{!row.catalog && <small>{fitmentStatusReasons[row.status] || "Araç kataloğunda doğrulanmış bağlantı bulunmuyor."}</small>}</td>
      </tr>)}</tbody></table>{!rows.length && <p className="enrichment-vehicle-empty">Bu filtreyle eşleşen araç bulunamadı.</p>}</div>
      <p className="enrichment-vehicle-footnote">Eşleşen kayıtlar araç kataloğuna bağlıdır. Teknik bilgiler kaynak satırını gösterir; motor kodları katalogda ayrıca doğrulanmaz.</p>
    </>}
  </section>;
}
