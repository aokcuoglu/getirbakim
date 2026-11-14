"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CarFront, CircleAlert, Search } from "lucide-react";
import { StatusBadge } from "@/components/admin/status-badge";
import { fitmentMaxQuery, fitmentPageSize, fitmentStatusLabels, fitmentStatusReasons, type AdminFitmentDetails, type FitmentFilter } from "@/modules/admin/fitment-details";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Result = { key: string; data: AdminFitmentDetails; rows: AdminFitmentDetails["rows"] };
const failureText = (reason: unknown) => reason instanceof Error ? reason.message : "Araç bilgileri yüklenemedi.";

export function EnrichmentVehicles({ productId }: { productId: string }) {
  const id = useId();
  const [filter, setFilter] = useState<FitmentFilter>("all");
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  // Responses are stored with the request they answer; anything that no longer matches `key` is ignored.
  const [result, setResult] = useState<Result | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const key = `${productId}|${filter}|${query}|${attempt}`;
  const keyRef = useRef(key);
  const moreAbort = useRef<AbortController | null>(null);
  const fetchPage = (offset: number, signal: AbortSignal) => {
    const params = new URLSearchParams({ vehiclesOffset: String(offset), vehiclesLimit: String(fitmentPageSize), vehiclesFilter: filter, vehiclesQuery: query });
    return fetch(`/api/admin/product-fitments/${productId}?${params}`, { cache: "no-store", signal })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 403 ? "Oturumun sona ermiş olabilir. Yönetici hesabınla yeniden giriş yap." : "Araç bilgileri yüklenemedi.");
        return response.json() as Promise<AdminFitmentDetails>;
      });
  };
  useEffect(() => {
    const timer = setTimeout(() => setQuery(queryInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [queryInput]);
  useEffect(() => {
    keyRef.current = key;
    const controller = new AbortController();
    fetchPage(0, controller.signal)
      .then(data => { setFailure(null); setMoreError(""); setLoadingMore(false); setResult({ key, data, rows: data.rows }); })
      .catch(reason => { if (!controller.signal.aborted) setFailure({ key, message: failureText(reason) }); });
    return () => { controller.abort(); moreAbort.current?.abort(); };
    // fetchPage only closes over productId, filter and query, which are part of `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const current = result?.key === key ? result : null;
  const currentError = failure?.key === key ? failure.message : "";
  const loadMore = () => {
    if (!current) return;
    const requestKey = key, offset = current.rows.length, controller = new AbortController();
    moreAbort.current = controller;
    setLoadingMore(true); setMoreError("");
    fetchPage(offset, controller.signal)
      .then(data => {
        if (controller.signal.aborted || keyRef.current !== requestKey) return;
        setResult(value => value && value.key === requestKey && value.rows.length === offset ? { key: requestKey, data, rows: [...value.rows, ...data.rows] } : value);
        setLoadingMore(false);
      })
      .catch(reason => { if (!controller.signal.aborted) { setMoreError(failureText(reason)); setLoadingMore(false); } });
  };
  const overview = result?.data;
  const filtered = current?.data.filtered ?? 0;
  const searching = query !== "" || filter !== "all";
  const retry = () => { setFailure(null); setAttempt(value => value + 1); };
  return <section className="flex flex-col gap-3" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`} className="flex items-center gap-2 text-sm font-semibold"><CarFront className="size-4" aria-hidden="true"/>Araç / motor eşleşmeleri</h3>
    {!overview ? (currentError ? <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertTitle>Araç bilgileri alınamadı</AlertTitle><AlertDescription>{currentError}</AlertDescription><AlertAction><Button variant="outline" onClick={retry}>Tekrar dene</Button></AlertAction></Alert>
      : <div className="flex flex-col gap-2" role="status"><span className="sr-only">Araç bilgileri yükleniyor…</span><Skeleton className="h-8 w-full"/><Skeleton className="h-24 w-full"/></div>)
    : !overview.total ? <p className="text-sm text-muted-foreground">{overview.modelCount ? `${overview.modelCount} model adı kaydedilmiş; motor ayrıntıları henüz aktarılmamış.` : "Bu ürün için henüz araç / motor bilgisi aktarılmamış."}</p> : <>
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline" className="tabular-nums">{overview.total} toplam</Badge>
        <StatusBadge tone="success" className="tabular-nums">{overview.matched} eşleşen</StatusBadge>
        <StatusBadge tone="warning" className="tabular-nums">{overview.total - overview.matched} eşleşmeyen</StatusBadge>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <InputGroup className="flex-1"><InputGroupAddon><Search aria-hidden="true"/></InputGroupAddon><InputGroupInput type="search" aria-label="Araç, motor veya tip kimliği ara" maxLength={fitmentMaxQuery} value={queryInput} onChange={event => setQueryInput(event.target.value)} placeholder="Araç, motor kodu veya tip kimliği ara…"/></InputGroup>
        <NativeSelect className="sm:w-48" aria-label="Araç eşleşme durumu" value={filter} onChange={event => setFilter(event.target.value as FitmentFilter)}><NativeSelectOption value="all">Tüm araçlar</NativeSelectOption><NativeSelectOption value="matched">Eşleşen araçlar</NativeSelectOption><NativeSelectOption value="unmatched">Eşleşmeyen araçlar</NativeSelectOption></NativeSelect>
      </div>
      <p className="text-sm text-muted-foreground tabular-nums" role="status">{current ? `${current.rows.length} / ${filtered} satır gösteriliyor${searching ? ` (toplam ${current.data.total})` : ""}` : ""}</p>
      <div role="region" aria-label="Araç eşleşme listesi">
        {currentError ? <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertTitle>Araç bilgileri alınamadı</AlertTitle><AlertDescription>{currentError}</AlertDescription><AlertAction><Button variant="outline" onClick={retry}>Tekrar dene</Button></AlertAction></Alert>
        : !current ? <div className="flex flex-col gap-2" role="status"><span className="sr-only">Araç bilgileri yükleniyor…</span><Skeleton className="h-24 w-full"/><Skeleton className="h-24 w-full"/></div>
        : !current.rows.length ? <p className="py-4 text-sm text-muted-foreground">Bu arama ve filtreyle eşleşen araç bulunamadı.</p> : <>
          <Table controls={false}><TableHeader><TableRow><TableHead>Araç / motor</TableHead><TableHead>Teknik bilgiler</TableHead><TableHead>Üretim aralığı</TableHead><TableHead>Eşleşme sonucu</TableHead></TableRow></TableHeader><TableBody>{result.rows.map(row => <TableRow key={row.index}>
          <TableCell className="whitespace-normal"><div className="font-semibold">{row.source.model}</div><div>{row.source.engineAndCodes}</div>{row.catalog && <div className="text-muted-foreground">Katalog: {row.catalog.brand} {row.catalog.model} · {row.catalog.engine}<br/>Araç tipi #{row.catalog.typeId}</div>}</TableCell>
          <TableCell className="tabular-nums">{row.source.ps} PS · {row.source.kw} kW{row.source.cc > 0 && <div>{row.source.cc} cm³</div>}<div className="text-muted-foreground">{row.source.fuel}</div></TableCell>
          <TableCell className="tabular-nums">{row.source.from}<div>– {row.source.to || "Bitiş belirtilmemiş"}</div></TableCell>
          <TableCell className="whitespace-normal"><StatusBadge tone={row.catalog ? "success" : "warning"}>{fitmentStatusLabels[row.status] || row.status}</StatusBadge>{!row.catalog && <div className="text-muted-foreground">{fitmentStatusReasons[row.status] || "Araç kataloğunda doğrulanmış bağlantı bulunmuyor."}</div>}</TableCell>
        </TableRow>)}</TableBody></Table>
          {moreError && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertTitle>Sonraki satırlar alınamadı</AlertTitle><AlertDescription>{moreError}</AlertDescription><AlertAction><Button variant="outline" onClick={loadMore}>Tekrar dene</Button></AlertAction></Alert>}
          {filtered > fitmentPageSize && <Button variant="outline" className="mt-2 w-full sm:w-auto" aria-busy={loadingMore} disabled={loadingMore || current.rows.length >= filtered} onClick={loadMore}>{current.rows.length >= filtered ? "Tümü yüklendi" : loadingMore ? "Yükleniyor…" : `Daha fazla göster (${Math.min(fitmentPageSize, filtered - current.rows.length)} satır)`}</Button>}
        </>}
      </div>
      <p className="text-sm text-muted-foreground">Eşleşen kayıtlar araç kataloğuna bağlıdır. Teknik bilgiler kaynak satırını gösterir; motor kodları katalogda ayrıca doğrulanmaz.</p>
    </>}
  </section>;
}
