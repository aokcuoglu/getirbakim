"use client";

import { useEffect, useId, useState } from "react";
import { CarFront, CircleAlert, Search } from "lucide-react";
import { StatusBadge } from "@/components/admin/status-badge";
import { fitmentPageSize, fitmentStatusLabels, fitmentStatusReasons, type AdminFitmentDetails, type FitmentFilter } from "@/modules/admin/fitment-details";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Rows = AdminFitmentDetails["rows"];

export function EnrichmentVehicles({ productId }: { productId: string }) {
  const id = useId();
  const [data, setData] = useState<AdminFitmentDetails | null>(null);
  const [rows, setRows] = useState<Rows>([]);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<FitmentFilter>("all");
  const [query, setQuery] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const fetchPage = (offset: number, signal?: AbortSignal) => {
    const params = new URLSearchParams({ vehiclesOffset: String(offset), vehiclesLimit: String(fitmentPageSize), vehiclesFilter: filter });
    return fetch(`/api/admin/product-fitments/${productId}?${params}`, { cache: "no-store", signal })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 403 ? "Oturumun sona ermiş olabilir. Yönetici hesabınla yeniden giriş yap." : "Araç bilgileri yüklenemedi.");
        return response.json() as Promise<AdminFitmentDetails>;
      });
  };
  useEffect(() => {
    const controller = new AbortController();
    fetchPage(0, controller.signal).then(value => { setError(""); setData(value); setRows(value.rows); setMoreError(""); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Araç bilgileri yüklenemedi."); });
    return () => controller.abort();
    // fetchPage only closes over productId and filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, attempt, filter]);
  const loadMore = () => {
    setLoadingMore(true); setMoreError("");
    fetchPage(rows.length).then(value => { setData(value); setRows(current => [...current, ...value.rows]); })
      .catch(reason => setMoreError(reason instanceof Error ? reason.message : "Araç bilgileri yüklenemedi."))
      .finally(() => setLoadingMore(false));
  };
  const normalize = (value: string) => value.toLocaleLowerCase("tr").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i");
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const visible = rows.filter(row => {
    const haystack = normalize(`${row.source.model} ${row.source.engineAndCodes} ${row.source.ps} ${row.source.kw} ${row.source.cc} ${row.catalog?.typeId || ""} ${fitmentStatusLabels[row.status] || row.status}`);
    return terms.every(term => haystack.includes(term));
  });
  const shown = filter === "all" ? data?.total ?? 0 : filter === "matched" ? data?.matched ?? 0 : (data?.total ?? 0) - (data?.matched ?? 0);
  return <section className="flex flex-col gap-3" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`} className="flex items-center gap-2 text-sm font-semibold"><CarFront className="size-4" aria-hidden="true"/>Araç / motor eşleşmeleri</h3>
    {error ? <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertTitle>Araç bilgileri alınamadı</AlertTitle><AlertDescription>{error}</AlertDescription><AlertAction><Button variant="outline" onClick={() => { setError(""); setAttempt(value => value + 1); }}>Tekrar dene</Button></AlertAction></Alert>
    : !data ? <div className="flex flex-col gap-2" role="status"><span className="sr-only">Araç bilgileri yükleniyor…</span><Skeleton className="h-8 w-full"/><Skeleton className="h-24 w-full"/></div>
    : !data.total ? <p className="text-sm text-muted-foreground">{data.modelCount ? `${data.modelCount} model adı kaydedilmiş; motor ayrıntıları henüz aktarılmamış.` : "Bu ürün için henüz araç / motor bilgisi aktarılmamış."}</p> : <>
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline" className="tabular-nums">{data.total} toplam</Badge>
        <StatusBadge tone="success" className="tabular-nums">{data.matched} eşleşen</StatusBadge>
        <StatusBadge tone="warning" className="tabular-nums">{data.total - data.matched} eşleşmeyen</StatusBadge>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <InputGroup className="flex-1"><InputGroupAddon><Search aria-hidden="true"/></InputGroupAddon><InputGroupInput type="search" aria-label="Araç, motor veya tip kimliği ara" value={query} onChange={event => setQuery(event.target.value)} placeholder="Araç, motor kodu veya tip kimliği ara…"/></InputGroup>
        <NativeSelect className="sm:w-48" aria-label="Araç eşleşme durumu" value={filter} onChange={event => setFilter(event.target.value as FitmentFilter)}><NativeSelectOption value="all">Tüm araçlar</NativeSelectOption><NativeSelectOption value="matched">Eşleşen araçlar</NativeSelectOption><NativeSelectOption value="unmatched">Eşleşmeyen araçlar</NativeSelectOption></NativeSelect>
      </div>
      <p className="text-sm text-muted-foreground tabular-nums" role="status">{terms.length ? `${visible.length} satır aramayla eşleşti · ` : ""}{rows.length} / {shown} satır yüklendi</p>
      <div role="region" aria-label="Araç eşleşme listesi">
        <Table><TableHeader><TableRow><TableHead>Araç / motor</TableHead><TableHead>Teknik bilgiler</TableHead><TableHead>Üretim aralığı</TableHead><TableHead>Eşleşme sonucu</TableHead></TableRow></TableHeader><TableBody>{visible.map(row => <TableRow key={row.index}>
          <TableCell className="whitespace-normal"><div className="font-semibold">{row.source.model}</div><div>{row.source.engineAndCodes}</div>{row.catalog && <div className="text-muted-foreground">Katalog: {row.catalog.brand} {row.catalog.model} · {row.catalog.engine}<br/>Araç tipi #{row.catalog.typeId}</div>}</TableCell>
          <TableCell className="tabular-nums">{row.source.ps} PS · {row.source.kw} kW{row.source.cc > 0 && <div>{row.source.cc} cm³</div>}<div className="text-muted-foreground">{row.source.fuel}</div></TableCell>
          <TableCell className="tabular-nums">{row.source.from}<div>– {row.source.to || "Bitiş belirtilmemiş"}</div></TableCell>
          <TableCell className="whitespace-normal"><StatusBadge tone={row.catalog ? "success" : "warning"}>{fitmentStatusLabels[row.status] || row.status}</StatusBadge>{!row.catalog && <div className="text-muted-foreground">{fitmentStatusReasons[row.status] || "Araç kataloğunda doğrulanmış bağlantı bulunmuyor."}</div>}</TableCell>
        </TableRow>)}</TableBody></Table>
        {!visible.length && <p className="py-4 text-sm text-muted-foreground">{rows.length ? "Yüklenen satırlarda aramayla eşleşen araç yok; sonraki satırları yükleyebilirsin." : "Bu filtreyle eşleşen araç bulunamadı."}</p>}
        {moreError && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertTitle>Sonraki satırlar alınamadı</AlertTitle><AlertDescription>{moreError}</AlertDescription></Alert>}
        {rows.length < shown && <Button variant="outline" className="mt-2 w-full sm:w-auto" disabled={loadingMore} onClick={loadMore}>{loadingMore ? "Yükleniyor…" : `Daha fazla göster (${Math.min(fitmentPageSize, shown - rows.length)} satır)`}</Button>}
      </div>
      <p className="text-sm text-muted-foreground">Eşleşen kayıtlar araç kataloğuna bağlıdır. Teknik bilgiler kaynak satırını gösterir; motor kodları katalogda ayrıca doğrulanmaz.</p>
    </>}
  </section>;
}
