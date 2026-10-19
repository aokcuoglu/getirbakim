import Link from "next/link";
import { CircleAlert, CircleCheck, Droplets, Info, TriangleAlert } from "lucide-react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { LiveRefresh } from "@/components/admin/live-refresh";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { vehicleOilsData, VEHICLE_OILS_ROWS } from "@/modules/admin/vehicle-oils";

const number = (value: number) => new Intl.NumberFormat("tr-TR").format(value);
const time = (value: Date) => new Date(value).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const duration = (minutes: number) => minutes >= 1440 ? `${Math.floor(minutes / 1440)} gün ${Math.floor(minutes % 1440 / 60)} sa`
  : minutes >= 60 ? `${Math.floor(minutes / 60)} sa ${minutes % 60} dk` : `${minutes} dk`;
const share = (part: number, whole: number) => whole ? Math.round(part / whole * 100) : 0;
const SHOWN_SPECIFICATIONS = 4;
// Clock time `minutes` from now in Istanbul; another day's finish also names the day.
const finishAt = (minutes: number) => {
  const at = new Date(Date.now() + minutes * 60000), day = (value: Date) => value.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" });
  return at.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", ...(day(at) === day(new Date()) ? {} : { day: "numeric", month: "short" }), hour: "2-digit", minute: "2-digit" });
};

export default async function VehicleOils({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = normalizeSearchParams(await searchParams);
  const data = await vehicleOilsData(params);
  const { summary, run, host } = data;
  const percent = summary.target ? Math.floor(summary.collected / summary.target * 1000) / 10 : 0;
  const remaining = Math.max(0, summary.target - summary.collected);
  const running = run?.status === "running" && summary.lastTen > 0;
  const left = summary.lastHour ? Math.round(remaining / summary.lastHour * 60) : 0;
  const withoutOil = summary.collected - summary.withOil;

  return <div className="flex flex-col gap-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Yağ verileri</h1>
        <p className="text-sm text-muted-foreground">Trodo&apos;dan (TecRMI) toplanan araç tipi motor yağı verileri; yeni gelenler en üstte. Toplama <code>npm run vehicles:oil-trodo -- collect</code> ile çalışır, bitince <code>export</code> + <code>npm run db:vehicle-oils</code>.</p>
      </div>
      <LiveRefresh seconds={30}/>
    </div>
    {host?.blocked && <Alert variant="destructive">
      <CircleAlert aria-hidden="true"/>
      <AlertTitle>Trodo erişimi engellendi</AlertTitle>
      <AlertDescription>{host.last_error ?? "Kaynak engel bildirdi."}{host.challenge_since ? ` · ${time(host.challenge_since)} itibarıyla` : ""}</AlertDescription>
    </Alert>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card>
        <CardHeader><CardDescription>İlerleme</CardDescription><CardTitle className="text-2xl tabular-nums">%{percent.toLocaleString("tr-TR")}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2"><Progress value={percent} aria-label="Toplama ilerlemesi"/><span className="text-sm text-muted-foreground tabular-nums">{number(summary.collected)} / {number(summary.target)} araç tipi</span></CardContent>
      </Card>
      <Card>
        <CardHeader><CardDescription>Durum</CardDescription><CardTitle className="text-2xl tabular-nums">{number(summary.lastHour)} / saat</CardTitle></CardHeader>
        <CardContent className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
          {run?.status === "complete" && !remaining ? <Badge variant="success"><CircleCheck data-icon="inline-start" aria-hidden="true"/>Tamamlandı</Badge>
            : run?.status === "blocked" ? <Badge variant="destructive"><CircleAlert data-icon="inline-start" aria-hidden="true"/>Engellendi</Badge>
            : running ? <Badge variant="success"><CircleCheck data-icon="inline-start" aria-hidden="true"/>Çalışıyor</Badge>
            : run?.status === "running" ? <Badge variant="warning"><TriangleAlert data-icon="inline-start" aria-hidden="true"/>Son 10 dk sessiz</Badge>
            : <Badge variant="warning"><TriangleAlert data-icon="inline-start" aria-hidden="true"/>{run ? "Durduruldu" : "Henüz koşu yok"}</Badge>}
          <span className="tabular-nums">{running && remaining && summary.lastHour ? `Tahmini bitiş: ${finishAt(left)} (${duration(left)})` : summary.lastFetch ? `Son çekim: ${time(summary.lastFetch)}` : "Henüz çekim yok"}</span>
          {host && <span className="tabular-nums">İstek aralığı {number(host.interval_ms / 1000)} sn + 0–{number(host.jitter_ms / 1000)} sn</span>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardDescription>Yağ verisi bulunan</CardDescription><CardTitle className="text-2xl tabular-nums">{number(summary.withOil)}</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground tabular-nums">Toplananların %{share(summary.withOil, summary.collected)}&apos;i · {number(summary.withSpecifications)} tipte şartname/onay</CardContent>
      </Card>
      <Card>
        <CardHeader><CardDescription>Verisiz / başarısız</CardDescription><CardTitle className="text-2xl tabular-nums">{number(withoutOil)} / {number(run?.failed ?? 0)}</CardTitle></CardHeader>
        <CardContent className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
          {run?.failed ? <Badge variant="destructive"><CircleAlert data-icon="inline-start" aria-hidden="true"/>Yeniden denenecek</Badge>
            : <Badge variant="info"><Info data-icon="inline-start" aria-hidden="true"/>Başarısız istek yok</Badge>}
          <span>Verisiz: Trodo&apos;da araç için yağ bilgisi yok. Başarısız istekler sonraki koşuda yeniden denenir.</span>
        </CardContent>
      </Card>
    </div>
    <Card>
      <CardHeader>
        <CardTitle>Son toplanan araçlar</CardTitle>
        <CardDescription>Değerler kaynağın yazdığı gibidir; dışa aktarımda normalize edilip data/vehicle_type_oil_specs.csv dosyasına yazılır. En yeni {VEHICLE_OILS_ROWS} kayıt gösterilir.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form className="flex flex-wrap items-end gap-3" action="/yonetim/yag-verileri">
          <label className="flex flex-col gap-1 text-sm"><span className="text-muted-foreground">Marka, model, motor veya tip no</span><Input name="q" defaultValue={data.q} placeholder="corsa d 1.4, 125157…" className="w-64"/></label>
          <Button type="submit" variant="outline">Ara</Button>
          {data.q && <Button variant="ghost" nativeButton={false} render={<Link href="/yonetim/yag-verileri"/>}>Temizle</Button>}
        </form>
        {data.rows.length ? <Table>
          <TableHeader><TableRow>
            <TableHead>Araç</TableHead><TableHead>Hacim (L)</TableHead><TableHead>Viskozite</TableHead><TableHead>Şartname / onay</TableHead><TableHead>Çekim</TableHead>
          </TableRow></TableHeader>
          <TableBody>{data.rows.map(row => <TableRow key={row.vehicle_type_id}>
            <TableCell className="max-w-72"><div className="flex min-w-0 flex-col"><span className="truncate font-medium" title={row.full_name}>{row.full_name}</span><span className="text-xs text-muted-foreground tabular-nums">TA-{row.vehicle_type_id}</span></div></TableCell>
            <TableCell className="tabular-nums">{row.volumes.join(" · ") || <span className="text-muted-foreground">—</span>}</TableCell>
            <TableCell className="min-w-40 whitespace-normal">{row.viscosities.length ? row.viscosities.map(value => value.replace(/^SAE\s*/i, "")).join(", ")
              : <Badge variant="warning"><TriangleAlert data-icon="inline-start" aria-hidden="true"/>Veri yok</Badge>}</TableCell>
            <TableCell className="min-w-48 whitespace-normal" value={row.specifications.join(", ")}><span className="text-sm" title={row.specifications.join(", ")}>
              {row.specifications.slice(0, SHOWN_SPECIFICATIONS).join(", ") || <span className="text-muted-foreground">—</span>}
              {row.specifications.length > SHOWN_SPECIFICATIONS && <span className="text-muted-foreground"> +{row.specifications.length - SHOWN_SPECIFICATIONS}</span>}
            </span></TableCell>
            <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">{time(row.fetched_at)}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
          : <Empty><EmptyHeader><EmptyMedia variant="icon"><Droplets/></EmptyMedia><EmptyTitle>{data.q ? "Aramayla eşleşen araç yok." : "Henüz yağ verisi yok."}</EmptyTitle><EmptyDescription>Toplama çalıştıkça araçlar burada belirir.</EmptyDescription></EmptyHeader></Empty>}
      </CardContent>
    </Card>
  </div>;
}
