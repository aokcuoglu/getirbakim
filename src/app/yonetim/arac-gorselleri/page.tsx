import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight, CircleAlert, CircleCheck, ImageOff, Info, TriangleAlert } from "lucide-react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { LiveRefresh } from "@/components/admin/live-refresh";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { Progress } from "@/components/ui/progress";
import { vehicleTypeImagesData } from "@/modules/admin/vehicle-type-images";

const number = (value: number) => new Intl.NumberFormat("tr-TR").format(value);
const time = (value: Date) => new Date(value).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const duration = (minutes: number) => minutes >= 60 ? `${Math.floor(minutes / 60)} sa ${minutes % 60} dk` : `${minutes} dk`;
// Clock time `minutes` from now in Istanbul; another day's finish also names the day.
const finishAt = (minutes: number) => {
  const at = new Date(Date.now() + minutes * 60000), day = (value: Date) => value.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" });
  return at.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", ...(day(at) === day(new Date()) ? {} : { day: "numeric", month: "short" }), hour: "2-digit", minute: "2-digit" });
};

export default async function VehicleImages({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = normalizeSearchParams(await searchParams);
  const data = await vehicleTypeImagesData(params);
  const { summary } = data;
  const done = summary.found + summary.missing;
  const percent = summary.types ? Math.floor(done / summary.types * 1000) / 10 : 0;
  const perMinute = summary.lastTen / 10;
  const remaining = Math.max(0, summary.types - done);
  const running = summary.lastTen > 0;
  const left = perMinute ? Math.round(remaining / perMinute) : 0;
  const imageShare = summary.found ? Math.round(summary.images / summary.found * 100) : 0;
  const query = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ q: data.q || undefined, page: data.page > 1 ? String(data.page) : undefined, ...changes })) if (value) next.set(key, value);
    return `/yonetim/arac-gorselleri${next.size ? `?${next}` : ""}`;
  };
  const prev = data.page > 1 ? query({ page: String(data.page - 1) }) : null, next = data.page < data.pages ? query({ page: String(data.page + 1) }) : null;

  return <div className="flex flex-col gap-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Araç görselleri</h1>
        <p className="text-sm text-muted-foreground">REPXPERT&apos;ten toplanan araç tipi görselleri ve teknik verileri; yeni gelenler en üstte. Toplama <code>npm run vehicles:repxpert -- collect</code> ile çalışır.</p>
      </div>
      <LiveRefresh seconds={10}/>
    </div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card>
        <CardHeader><CardDescription>İlerleme</CardDescription><CardTitle className="text-2xl tabular-nums">%{percent.toLocaleString("tr-TR")}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2"><Progress value={percent} aria-label="Toplama ilerlemesi"/><span className="text-sm text-muted-foreground tabular-nums">{number(done)} / {number(summary.types)} araç tipi</span></CardContent>
      </Card>
      <Card>
        <CardHeader><CardDescription>Durum</CardDescription><CardTitle className="text-2xl tabular-nums">{number(perMinute)} / dk</CardTitle></CardHeader>
        <CardContent className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
          {running ? <Badge variant="success"><CircleCheck data-icon="inline-start" aria-hidden="true"/>Çalışıyor</Badge>
            : remaining ? <Badge variant="warning"><TriangleAlert data-icon="inline-start" aria-hidden="true"/>Son 10 dk sessiz</Badge>
            : <Badge variant="success"><CircleCheck data-icon="inline-start" aria-hidden="true"/>Tamamlandı</Badge>}
          <span className="tabular-nums">{running && remaining ? `Tahmini bitiş: ${finishAt(left)} (${duration(left)})` : summary.lastFetch ? `Son çekim: ${time(summary.lastFetch)}` : "Henüz çekim yok"}</span>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardDescription>Görselli araç tipi</CardDescription><CardTitle className="text-2xl tabular-nums">{number(summary.images)}</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground tabular-nums">Bulunanların %{imageShare}&apos;i · {number(summary.distinctImages)} farklı görsel</CardContent>
      </Card>
      <Card>
        <CardHeader><CardDescription>Bulunamayan / hatalı</CardDescription><CardTitle className="text-2xl tabular-nums">{number(summary.missing)} / {number(summary.errors)}</CardTitle></CardHeader>
        <CardContent className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
          {summary.errors ? <Badge variant="destructive"><CircleAlert data-icon="inline-start" aria-hidden="true"/>Hatalılar sonraki koşuda yeniden denenir</Badge>
            : <Badge variant="info"><Info data-icon="inline-start" aria-hidden="true"/>Hata yok</Badge>}
        </CardContent>
      </Card>
    </div>
    <Card>
      <CardHeader>
        <CardTitle>Son gelen görseller</CardTitle>
        <CardDescription>Aynı görseli paylaşan tipler tek kopya saklanır; mağaza araç seçiminde tipin görselini, yoksa modelin en yeni görselli tipininkini gösterir.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form className="flex flex-wrap items-end gap-3" action="/yonetim/arac-gorselleri">
          <label className="flex flex-col gap-1 text-sm"><span className="text-muted-foreground">Marka, model, motor veya tip no</span><Input name="q" defaultValue={data.q} placeholder="corsa d 1.4, 125157…" className="w-64"/></label>
          <Button type="submit" variant="outline">Ara</Button>
          {data.q && <Button variant="ghost" nativeButton={false} render={<Link href="/yonetim/arac-gorselleri"/>}>Temizle</Button>}
        </form>
        {data.rows.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {data.rows.map(row => <Card key={row.vehicle_type_id} size="sm">
            <CardContent className="flex flex-col gap-3">
              <AspectRatio ratio={row.width / row.height}>
                <Image src={row.src} alt={row.full_name} width={row.width} height={row.height} unoptimized className="size-full object-contain"/>
              </AspectRatio>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-sm font-medium" title={row.full_name}>{row.full_name}</span>
                <span className="truncate text-xs text-muted-foreground tabular-nums">TA-{row.vehicle_type_id}{row.body_type ? ` · ${row.body_type}` : ""}{row.engine_codes.length ? ` · ${row.engine_codes.join(", ")}` : ""}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{time(row.imported_at)}</span>
              </div>
            </CardContent>
          </Card>)}
        </div>
          : <Empty><EmptyHeader><EmptyMedia variant="icon"><ImageOff/></EmptyMedia><EmptyTitle>{data.q ? "Aramayla eşleşen görsel yok." : "Henüz görsel yok."}</EmptyTitle><EmptyDescription>Toplama çalıştıkça görseller burada belirir.</EmptyDescription></EmptyHeader></Empty>}
      </CardContent>
      {data.total > 0 && <CardFooter className="flex-wrap justify-between gap-3">
        <span className="text-sm text-muted-foreground tabular-nums">{number(data.total)} görselli tip</span>
        <Pagination aria-label="Sayfalar" className="mx-0 w-auto"><PaginationContent>
          <PaginationItem>{prev ? <Button variant="outline" size="icon" aria-label="Önceki sayfa" nativeButton={false} render={<Link href={prev} scroll={false}/>}><ChevronLeft/></Button> : <Button variant="outline" size="icon" aria-label="Önceki sayfa" disabled><ChevronLeft/></Button>}</PaginationItem>
          <PaginationItem><span className="px-2 text-sm text-muted-foreground tabular-nums" aria-label={`Sayfa ${data.page} / ${data.pages}`}>{number(data.page)} / {number(data.pages)}</span></PaginationItem>
          <PaginationItem>{next ? <Button variant="outline" size="icon" aria-label="Sonraki sayfa" nativeButton={false} render={<Link href={next} scroll={false}/>}><ChevronRight/></Button> : <Button variant="outline" size="icon" aria-label="Sonraki sayfa" disabled><ChevronRight/></Button>}</PaginationItem>
        </PaginationContent></Pagination>
      </CardFooter>}
    </Card>
  </div>;
}
