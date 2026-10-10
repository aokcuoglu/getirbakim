"use client";

import { useEffect, useId, useState } from "react";
import { CarFront, Search } from "lucide-react";
import { fitmentStatusLabels, fitmentStatusReasons, type AdminFitmentDetails } from "@/modules/admin/fitment-details";
import { StatusBadge } from "@/components/admin/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
  return <section className="flex flex-col gap-3 border-t pt-5" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`} className="flex items-center gap-2 text-sm font-semibold"><CarFront className="size-4" aria-hidden="true"/>Araç / motor eşleşmeleri</h3>
    {error ? <Alert variant="destructive" role="alert"><AlertDescription className="flex flex-wrap items-center gap-3">{error}<Button size="sm" variant="outline" onClick={() => { setError(""); setAttempt(value => value + 1); }}>Tekrar dene</Button></AlertDescription></Alert>
    : !data ? <div className="flex flex-col gap-2" role="status"><span className="sr-only">Araç bilgileri yükleniyor…</span><Skeleton className="h-8 w-full"/><Skeleton className="h-24 w-full"/></div>
    : !data.rows.length ? <p className="text-sm text-muted-foreground">{data.modelCount ? `${data.modelCount} model adı kaydedilmiş; motor ayrıntıları henüz aktarılmamış.` : "Bu ürün için henüz araç / motor bilgisi aktarılmamış."}</p> : <>
      <div className="flex flex-wrap gap-1.5 text-xs">
        <Badge variant="secondary" className="tabular-nums"><b>{data.rows.length}</b> toplam</Badge>
        <Badge variant="outline" className="border-success/20 bg-success/10 text-success tabular-nums"><b>{matched}</b> eşleşen</Badge>
        <Badge variant="outline" className="border-warning/25 bg-warning/10 text-warning tabular-nums"><b>{data.rows.length - matched}</b> eşleşmeyen</Badge>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <InputGroup className="flex-1"><InputGroupAddon><Search aria-hidden="true"/></InputGroupAddon><InputGroupInput type="search" aria-label="Araç, motor veya tip kimliği ara" value={query} onChange={event => setQuery(event.target.value)} placeholder="Araç, motor kodu veya tip kimliği ara…"/></InputGroup>
        <NativeSelect className="sm:w-48" aria-label="Araç eşleşme durumu" value={filter} onChange={event => setFilter(event.target.value)}><NativeSelectOption value="all">Tüm araçlar</NativeSelectOption><NativeSelectOption value="matched">Eşleşen araçlar</NativeSelectOption><NativeSelectOption value="unmatched">Eşleşmeyen araçlar</NativeSelectOption></NativeSelect>
      </div>
      <p className="text-xs text-muted-foreground tabular-nums" role="status">{rows.length} / {data.rows.length} satır gösteriliyor</p>
      <div className="max-h-[26rem] overflow-auto rounded-lg border" tabIndex={0} role="region" aria-label="Araç eşleşme listesi">
        <Table className="min-w-[44rem] text-xs"><TableHeader className="sticky top-0 z-10 bg-muted"><TableRow><TableHead>Araç / motor</TableHead><TableHead>Teknik bilgiler</TableHead><TableHead>Üretim aralığı</TableHead><TableHead>Eşleşme sonucu</TableHead></TableRow></TableHeader><TableBody>{rows.map(row => <TableRow key={row.index} className="align-top">
          <TableCell className="w-[36%] whitespace-normal"><div className="font-semibold">{row.source.model}</div><div>{row.source.engineAndCodes}</div>{row.catalog && <div className="mt-1 text-muted-foreground">Katalog: {row.catalog.brand} {row.catalog.model} · {row.catalog.engine}<br/>Araç tipi #{row.catalog.typeId}</div>}</TableCell>
          <TableCell className="tabular-nums">{row.source.ps} PS · {row.source.kw} kW{row.source.cc > 0 && <div>{row.source.cc} cm³</div>}<div className="text-muted-foreground">{row.source.fuel}</div></TableCell>
          <TableCell className="tabular-nums">{row.source.from}<div>– {row.source.to || "Bitiş belirtilmemiş"}</div></TableCell>
          <TableCell className="whitespace-normal"><StatusBadge tone={row.catalog ? "success" : "warning"}>{fitmentStatusLabels[row.status] || row.status}</StatusBadge>{!row.catalog && <div className="mt-1 text-muted-foreground">{fitmentStatusReasons[row.status] || "Araç kataloğunda doğrulanmış bağlantı bulunmuyor."}</div>}</TableCell>
        </TableRow>)}</TableBody></Table>
        {!rows.length && <p className="p-4 text-sm text-muted-foreground">Bu filtreyle eşleşen araç bulunamadı.</p>}
      </div>
      <p className="text-xs text-muted-foreground">Eşleşen kayıtlar araç kataloğuna bağlıdır. Teknik bilgiler kaynak satırını gösterir; motor kodları katalogda ayrıca doğrulanmaz.</p>
    </>}
  </section>;
}
