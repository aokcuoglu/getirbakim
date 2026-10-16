import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight, CircleAlert, CircleCheck, ExternalLink, ImageOff, Info, RotateCcw, TriangleAlert } from "lucide-react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { vehicleImagesData, type ImageStatus } from "@/modules/admin/vehicle-model-images";
import { approveGenerationMatches, reviewVehicleImage } from "./actions";

const number = (value: number) => new Intl.NumberFormat("tr-TR").format(value);
const date = (value: Date) => new Date(value).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const statusLabels: Record<ImageStatus | "all", string> = { pending: "Bekleyen", approved: "Onaylı", rejected: "Reddedilen", all: "Tümü" };
const kindLabels = { generation: "Nesil", family: "Aile" } as const;
const reviewedMessages: Record<string, string> = { approved: "Görsel onaylandı; mağazada araç seçiminde gösteriliyor.", rejected: "Görsel reddedildi; mağazada ikon gösterilir.", pending: "Görsel yeniden beklemeye alındı." };

function StatusBadge({ status }: { status: ImageStatus }) {
  if (status === "approved") return <Badge variant="success"><CircleCheck data-icon="inline-start" aria-hidden="true"/>Onaylı</Badge>;
  if (status === "rejected") return <Badge variant="destructive"><CircleAlert data-icon="inline-start" aria-hidden="true"/>Reddedildi</Badge>;
  return <Badge variant="warning"><TriangleAlert data-icon="inline-start" aria-hidden="true"/>Bekliyor</Badge>;
}
function KindBadge({ kind }: { kind: "generation" | "family" }) {
  return kind === "generation" ? <Badge variant="info"><Info data-icon="inline-start" aria-hidden="true"/>Nesil</Badge>
    : <Badge variant="warning" title="Yalnız model ailesi eşleşti; fotoğraf başka bir nesle ait olabilir"><TriangleAlert data-icon="inline-start" aria-hidden="true"/>Aile</Badge>;
}

export default async function VehicleImages({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = normalizeSearchParams(await searchParams);
  const data = await vehicleImagesData(params);
  const query = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ status: data.status === "pending" ? undefined : data.status, kind: data.kind || undefined, q: data.q || undefined, sort: params.sort, dir: params.dir, page: params.page, ...changes })) if (value) next.set(key, value);
    return `/yonetim/arac-gorselleri${next.size ? `?${next}` : ""}`;
  };
  const back = query({});
  const prev = data.page > 1 ? query({ page: String(data.page - 1) }) : null, next = data.page < data.pages ? query({ page: String(data.page + 1) }) : null;
  const message = params.reviewed ? reviewedMessages[params.reviewed] : params.approved ? `${number(Number(params.approved))} nesil eşleşmesi onaylandı.` : params.error ? "İşlem uygulanamadı; girdi geçersiz." : null;
  const coveragePercent = data.coverage.models ? Math.round(data.coverage.approved / data.coverage.models * 100) : 0;

  return <div className="flex flex-col gap-6">
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Araç görselleri</h1>
      <p className="text-sm text-muted-foreground">Araç seçiminde model serisinin yanında gösterilen fotoğraflar. Kaynak Wikidata ve Wikimedia Commons; yalnız onaylı görseller mağazaya çıkar ve her görsel yazar + lisans bilgisiyle gösterilir.</p>
    </div>
    {message && <Alert variant={params.error ? "destructive" : "success"}>{params.error ? <CircleAlert/> : <CircleCheck/>}<AlertDescription>{message}</AlertDescription></Alert>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card><CardHeader><CardDescription>Onaylı kapsam</CardDescription><CardTitle className="text-2xl tabular-nums">%{coveragePercent}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground tabular-nums">{number(data.coverage.approved)} / {number(data.coverage.models)} model serisi</CardContent></Card>
      <Card><CardHeader><CardDescription>Bekleyen</CardDescription><CardTitle className="text-2xl tabular-nums">{number(data.counts.pending)}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground tabular-nums">{number(data.counts.generationPending)} nesil · {number(data.counts.familyPending)} aile</CardContent></Card>
      <Card><CardHeader><CardDescription>Reddedilen</CardDescription><CardTitle className="text-2xl tabular-nums">{number(data.counts.rejected)}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">Mağazada ikon gösterilir</CardContent></Card>
      <Card><CardHeader><CardDescription>Eşleşme bulunamadı</CardDescription><CardTitle className="text-2xl tabular-nums">{number(data.coverage.none)}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground tabular-nums">{number(data.coverage.attempted)} seri denendi</CardContent></Card>
    </div>
    <Card>
      <CardHeader>
        <CardTitle>Eşleşmeler</CardTitle>
        <CardDescription>Nesil eşleşmesi: Wikidata öğesi serinin kendisini adlandırıyor. Aile eşleşmesi: yalnız model ailesi bulundu; fotoğraf onaylanmadan önce doğru nesli gösterdiği kontrol edilmeli.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <form className="flex flex-wrap items-end gap-3" action="/yonetim/arac-gorselleri">
            <label className="flex flex-col gap-1 text-sm"><span className="text-muted-foreground">Durum</span>
              <NativeSelect name="status" defaultValue={data.status}>{(["pending", "approved", "rejected", "all"] as const).map(value => <NativeSelectOption key={value} value={value}>{statusLabels[value]}</NativeSelectOption>)}</NativeSelect></label>
            <label className="flex flex-col gap-1 text-sm"><span className="text-muted-foreground">Eşleşme</span>
              <NativeSelect name="kind" defaultValue={data.kind}><NativeSelectOption value="">Tümü</NativeSelectOption><NativeSelectOption value="generation">Nesil</NativeSelectOption><NativeSelectOption value="family">Aile</NativeSelectOption></NativeSelect></label>
            <label className="flex flex-col gap-1 text-sm"><span className="text-muted-foreground">Marka / model</span><Input name="q" defaultValue={data.q} placeholder="RENAULT, Clio…" className="w-56"/></label>
            <Button type="submit" variant="outline">Filtrele</Button>
          </form>
          {data.counts.generationPending > 0 && <form action={approveGenerationMatches} className="ml-auto flex items-end gap-2">
            <input type="hidden" name="back" value={back}/>
            <label className="flex flex-col gap-1 text-sm"><span className="text-muted-foreground">Toplu onay</span>
              <NativeSelect name="brand" defaultValue=""><NativeSelectOption value="">Tüm markalar</NativeSelectOption>{data.brands.map(brand => <NativeSelectOption key={brand} value={brand}>{brand}</NativeSelectOption>)}</NativeSelect></label>
            <Button type="submit"><CircleCheck data-icon="inline-start" aria-hidden="true"/>Nesil eşleşmelerini onayla ({number(data.counts.generationPending)})</Button>
          </form>}
        </div>
        {data.rows.length ? <Table server><caption className="sr-only">Model serisi görselleri</caption>
          <TableHeader><TableRow>
            <TableHead>Görsel</TableHead>
            <TableHead sortKey="brand">Marka</TableHead>
            <TableHead sortKey="model">Model serisi</TableHead>
            <TableHead>Wikidata öğesi</TableHead>
            <TableHead sortKey="kind" filter={{ param: "kind", options: [{ value: "generation", label: "Nesil" }, { value: "family", label: "Aile" }] }}>Eşleşme</TableHead>
            <TableHead sortKey="license">Lisans</TableHead>
            <TableHead sortKey="status" filter={{ param: "status", options: (["pending", "approved", "rejected", "all"] as const).map(value => ({ value, label: statusLabels[value] })) }}>Durum</TableHead>
            <TableHead sortKey="imported">Alındı</TableHead>
            <TableHead><span className="sr-only">İşlem</span></TableHead>
          </TableRow></TableHeader>
          <TableBody>{data.rows.map(row => <TableRow key={row.model_id}>
            <TableCell><a href={row.source_url} target="_blank" rel="noopener noreferrer" title={row.attribution} className="block h-16 w-24 overflow-hidden rounded-sm bg-muted">
              <Image src={row.src} alt={`${row.brand} ${row.model}`} width={row.width} height={row.height} unoptimized className="size-full object-cover"/></a></TableCell>
            <TableCell className="font-medium">{row.brand}</TableCell>
            <TableCell><div className="flex flex-col gap-0.5"><span className="font-medium">{row.model}</span><span className="text-xs text-muted-foreground tabular-nums">{row.date_from ?? "?"} – {row.date_to ?? "devam ediyor"}</span></div></TableCell>
            <TableCell><div className="flex max-w-56 flex-col gap-0.5"><a href={`https://www.wikidata.org/wiki/${row.wikidata_id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 truncate underline-offset-4 hover:underline">{row.wikidata_label}<ExternalLink className="size-3 shrink-0" aria-hidden="true"/></a><span className="truncate text-xs text-muted-foreground" title={row.matched_query}>Sorgu: {row.matched_query}</span></div></TableCell>
            <TableCell value={kindLabels[row.match_kind]}><KindBadge kind={row.match_kind}/></TableCell>
            <TableCell><div className="flex max-w-40 flex-col gap-0.5"><span>{row.license}</span><span className="truncate text-xs text-muted-foreground" title={row.author ?? ""}>{row.author ?? "—"}</span></div></TableCell>
            <TableCell value={statusLabels[row.status]}><StatusBadge status={row.status}/></TableCell>
            <TableCell className="text-muted-foreground tabular-nums">{date(row.imported_at)}</TableCell>
            <TableCell><div className="flex items-center gap-1">
              {row.status !== "approved" && <form action={reviewVehicleImage}><input type="hidden" name="model_id" value={row.model_id}/><input type="hidden" name="status" value="approved"/><input type="hidden" name="back" value={back}/>
                <Button type="submit" variant="outline" size="sm"><CircleCheck data-icon="inline-start" aria-hidden="true"/>Onayla</Button></form>}
              {row.status !== "rejected" && <form action={reviewVehicleImage}><input type="hidden" name="model_id" value={row.model_id}/><input type="hidden" name="status" value="rejected"/><input type="hidden" name="back" value={back}/>
                <Button type="submit" variant="ghost" size="sm"><ImageOff data-icon="inline-start" aria-hidden="true"/>Reddet</Button></form>}
              {row.status !== "pending" && <form action={reviewVehicleImage}><input type="hidden" name="model_id" value={row.model_id}/><input type="hidden" name="status" value="pending"/><input type="hidden" name="back" value={back}/>
                <Button type="submit" variant="ghost" size="icon" aria-label="Beklemeye al"><RotateCcw aria-hidden="true"/></Button></form>}
            </div></TableCell>
          </TableRow>)}</TableBody></Table>
          : <Empty><EmptyHeader><EmptyMedia variant="icon"><ImageOff/></EmptyMedia><EmptyTitle>Bu görünümde görsel yok.</EmptyTitle><EmptyDescription>Eşleştirme <code>npm run vehicles:images -- match</code> ile çalıştırılır; sonuçlar burada onay bekler.</EmptyDescription></EmptyHeader></Empty>}
      </CardContent>
      {data.total > 0 && <CardFooter className="flex-wrap justify-between gap-3">
        <span className="text-sm text-muted-foreground tabular-nums">{number(data.total)} kayıt</span>
        <Pagination aria-label="Sayfalar" className="mx-0 w-auto"><PaginationContent>
          <PaginationItem>{prev ? <Button variant="outline" size="icon" aria-label="Önceki sayfa" nativeButton={false} render={<Link href={prev} scroll={false}/>}><ChevronLeft/></Button> : <Button variant="outline" size="icon" aria-label="Önceki sayfa" disabled><ChevronLeft/></Button>}</PaginationItem>
          <PaginationItem><span className="px-2 text-sm text-muted-foreground tabular-nums" aria-label={`Sayfa ${data.page} / ${data.pages}`}>{number(data.page)} / {number(data.pages)}</span></PaginationItem>
          <PaginationItem>{next ? <Button variant="outline" size="icon" aria-label="Sonraki sayfa" nativeButton={false} render={<Link href={next} scroll={false}/>}><ChevronRight/></Button> : <Button variant="outline" size="icon" aria-label="Sonraki sayfa" disabled><ChevronRight/></Button>}</PaginationItem>
        </PaginationContent></Pagination>
      </CardFooter>}
    </Card>
  </div>;
}
