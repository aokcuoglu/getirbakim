import Link from "next/link";
import { EnrichmentDetails } from "@/components/admin/enrichment-details";
import { LiveRefresh } from "@/components/admin/live-refresh";
import { StatusBadge, type StatusTone } from "@/components/admin/status-badge";
import { formatDateTime, formatNumber } from "@/modules/admin/format";
import { ChevronLeft, ChevronRight, ArrowUpRight, CircleCheck, CircleHelp, Clock3, ImageIcon, Info, Layers3, Search, GitCompareArrows, CarFront } from "lucide-react";
import { requireAdmin } from "@/modules/auth/session";
import { enrichmentDashboard, type RecordTab } from "@/modules/admin/enrichment-data";
import { dataSource, enrichmentStatuses, enrichmentStatusTones, gapLabels, gapText, matchLabels, sourceLabels, sourceNames } from "@/modules/admin/enrichment-labels";
import { runProgress, type PartialGap } from "@/modules/admin/enrichment-pace";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { Progress } from "@/components/ui/progress";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const sourceStates:Record<string,string>={running:"Çalışıyor",idle:"Beklemede",blocked:"Kapalı · kaynak engelledi"};
const runStates:Record<string,[Tone,string]>={running:["success","Çalışıyor"],quiet:["warning","Son 15 dk sessiz"],complete:["success","Bitti"],blocked:["error","Kaynak engelledi"],stopped:["neutral","Durduruldu"],failed:["error","Hatayla durdu"]};
const sourceOptions=[{value:"trodo",label:"Trodo"},{value:"otoparcasan",label:"otoparcasan"},{value:"spareto",label:"spareto"},{value:"parts2world",label:"parts2world"}];
const matchOptions=[{value:"oem_reference",label:"OEM referansıyla"},{value:"exact_part",label:"Doğrudan marka / parça"},{value:"cross_reference",label:"Muadil referansıyla"}];
const number=formatNumber;
type Tone=StatusTone;
const statusBadge=(tone:Tone,label:React.ReactNode)=><StatusBadge tone={tone}>{label}</StatusBadge>;
const date=(value:Date)=>formatDateTime(value);

export default async function ProductDataAdmin({searchParams}:{searchParams:Promise<SearchParams>}) {
  await requireAdmin();
  const data=await enrichmentDashboard(normalizeSearchParams(await searchParams));
  const counts=Object.fromEntries(data.counts.map(row=>[row.status,row.count]));
  const total=data.counts.reduce((sum,row)=>sum+row.count,0);
  const attempted=total-(counts.pending||0), attention=(counts.review||0)+(counts.blocked||0)+(counts.failed||0);
  // Time left at the last hour's pace: hours up to two days, days beyond.
  const eta=(hours:number|null)=>hours===null?"—":hours<1?"1 saatten az":hours<48?`~${number(Math.ceil(hours))} saat`:`~${number(Math.round(hours/24*10)/10)} gün`;
  const perHour=data.sourceSummary.reduce((sum,source)=>sum+source.last_hour,0);
  const runningSources=data.sourceSummary.filter(source=>source.state==="running");
  const parts2world=data.sourceSummary.find(source=>source.source==="parts2world");
  const run=data.run?{...data.run,...runProgress(data.run,parts2world?.last_hour??0)}:null;
  const href=(changes:Record<string,string>)=>{
    const params=new URLSearchParams({...data.filters,...changes});
    for(const [key,value] of [...params])if(!value||value==="all"||value==="complete")params.delete(key);
    return `/yonetim/urun-verileri${params.size?`?${params}`:""}`;
  };
  const cards=[
    {label:"OEM referansıyla eşleşen",value:data.metrics.oem_matches,icon:GitCompareArrows,note:`${number(data.metrics.direct_matches)} doğrudan marka / parça eşleşmesi`},
    {label:"Araç / motor kaydı",value:data.metrics.vehicles,icon:CarFront,note:`${number(data.metrics.oem_numbers)} OEM referansı toplandı`},
    {label:"Görseli bulunan ürün",value:data.metrics.images,icon:ImageIcon,note:`${(Number(data.metrics.bytes)/1024/1024).toLocaleString("tr-TR",{maximumFractionDigits:1})} MB görsel depolanıyor`},
  ];
  // Every product is in exactly one tab (#388); the status column repeats it per row.
  const errors=(counts.blocked||0)+(counts.failed||0);
  const tabs:[RecordTab,string,number][]=[["complete","Tamamlanan",counts.complete||0],["partial","Kısmi veri",counts.partial||0],["review","İnceleme",counts.review||0],["not_found","Eşleşmeyen",counts.not_found||0],["error","Hatalı",errors],["pending","Bekleyen",counts.pending||0]];
  const prev=data.page>1?href({page:String(data.page-1)}):null, next=data.page<data.pages?href({page:String(data.page+1)}):null;
  const percent=total?attempted/total*100:0;
  return <div className="flex flex-col gap-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 max-w-3xl flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Ürün zenginleştirme</h1>
        <p className="text-muted-foreground">Trodo, otoparcasan, spareto ve parts2world&apos;den toplanan görsel, OEM, özellik ve araç verileri. Son aktarım: {data.metrics.latest?date(data.metrics.latest):"henüz yok"}.</p>
      </div>
      <LiveRefresh seconds={30} defaultOn={false}/>
    </div>

    <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Zenginleştirme özeti">
      <Card>
        <CardHeader><dt><CardDescription>Katalog kapsamı</CardDescription></dt><dd><CardTitle className="text-2xl tabular-nums">%{percent.toLocaleString("tr-TR",{maximumFractionDigits:2})}</CardTitle></dd><CardAction><Layers3 className="size-4 text-muted-foreground" aria-hidden="true"/></CardAction></CardHeader>
        <CardContent className="flex flex-col gap-2"><Progress value={percent} aria-label="İncelenen ürünler"/><span className="text-sm text-muted-foreground tabular-nums">{number(attempted)} / {number(total)} ürün incelendi</span></CardContent>
      </Card>
      <Card>
        <CardHeader><dt><CardDescription>Toplama hızı</CardDescription></dt><dd><CardTitle className="text-2xl tabular-nums">{number(perHour)} / saat</CardTitle></dd><CardAction><Clock3 className="size-4 text-muted-foreground" aria-hidden="true"/></CardAction></CardHeader>
        <CardContent className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
          {runningSources.length?statusBadge("success",`${runningSources.length} kaynak çalışıyor`):statusBadge("warning","Çalışan kaynak yok")}
          {runningSources.length?<span className="tabular-nums">{runningSources.map(source=>`${sourceLabels[source.source].name} ${number(source.last_hour)}`).join(" · ")} (son 1 saat)</span>:null}
          <span className="tabular-nums">Son 24 saatte {number(data.sourceSummary.reduce((sum,source)=>sum+source.searched,0))} arama · {number(data.sourceSummary.reduce((sum,source)=>sum+source.found,0))} bulundu</span>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><dt><CardDescription>Zenginleştirilen ürün</CardDescription></dt><dd><CardTitle className="text-2xl tabular-nums">{number(data.metrics.enriched)}</CardTitle></dd><CardAction><CircleCheck className="size-4 text-muted-foreground" aria-hidden="true"/></CardAction></CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm text-muted-foreground tabular-nums"><span>{number(counts.complete||0)} tamamlandı · {number(counts.partial||0)} kısmi</span><span>Son 24 saatte {number(data.pass.finished_24h+data.pass.fallback_pending_found_24h)} ürün işlendi</span></CardContent>
      </Card>
      <Card>
        <CardHeader><dt><CardDescription>Kontrol bekleyen</CardDescription></dt><dd><CardTitle className="text-2xl tabular-nums">{number(attention)}</CardTitle></dd><CardAction><CircleHelp className="size-4 text-muted-foreground" aria-hidden="true"/></CardAction></CardHeader>
        <CardContent className="flex flex-col items-start gap-2 text-sm text-muted-foreground tabular-nums">
          <span>{number(counts.review||0)} inceleme · {number(errors)} erişim / işlem hatası</span>
          {attention?<div className="flex flex-wrap gap-2">
            {counts.review?<Button variant="outline" size="sm" nativeButton={false} render={<Link href={href({status:"review",match:"all",q:"",page:"1"})} scroll={false}/>}>İncelemeyi aç<ArrowUpRight data-icon="inline-end" aria-hidden="true"/></Button>:null}
            {errors?<Button variant="outline" size="sm" nativeButton={false} render={<Link href={href({status:"error",match:"all",q:"",page:"1"})} scroll={false}/>}>Hataları aç<ArrowUpRight data-icon="inline-end" aria-hidden="true"/></Button>:null}
          </div>:null}
        </CardContent>
      </Card>
    </dl>

    <div className="grid items-start gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardHeader><CardTitle><h2>Veri kaynakları</h2></CardTitle><CardDescription>Hız son 1 saatteki, diğer sayılar son 24 saatteki aramalar; son 15 dakikada arama yapan kaynak çalışıyor sayılır.</CardDescription></CardHeader>
        <CardContent>
          <Table controls={false}><TableHeader><TableRow><TableHead>Kaynak</TableHead><TableHead>Durum</TableHead><TableHead className="text-right">Aranan</TableHead><TableHead className="text-right">Bulunan</TableHead><TableHead className="text-right">İsabet</TableHead><TableHead className="text-right">Hız</TableHead><TableHead className="text-right">Hata</TableHead><TableHead className="text-right">Toplam ürün</TableHead><TableHead>Son arama</TableHead></TableRow></TableHeader>
            <TableBody>{data.sourceSummary.map(source=><TableRow key={source.source}>
              <TableCell><div className="flex flex-col"><span className="font-medium">{sourceLabels[source.source].name}</span><span className="text-sm text-muted-foreground">{sourceLabels[source.source].role}</span>{source.source==="parts2world"&&run&&!data.run?.finished_at?<span className="text-sm text-muted-foreground tabular-nums">Tur %{Math.floor(run.percent)} · kalan {number(run.remaining)} · {eta(run.hoursLeft)}</span>:null}</div></TableCell>
              <TableCell>{statusBadge(source.state==="running"?"success":source.state==="blocked"?"error":"neutral",sourceStates[source.state])}</TableCell>
              <TableCell className="text-right tabular-nums">{number(source.searched)}</TableCell>
              <TableCell className="text-right tabular-nums">{number(source.found)}</TableCell>
              <TableCell className="text-right tabular-nums">{source.hitRate===null?"—":`%${Math.round(source.hitRate*100)}`}</TableCell>
              <TableCell className="text-right tabular-nums">{source.last_hour?`${number(source.last_hour)} / saat`:"—"}</TableCell>
              <TableCell className={`text-right tabular-nums${source.errors?" text-warning":""}`}>{number(source.errors)}</TableCell>
              <TableCell className="text-right tabular-nums">{number(source.written)}</TableCell>
              <TableCell className="tabular-nums text-muted-foreground">{source.last?date(source.last):"Henüz yok"}</TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </CardContent>
      </Card>
      <div className="flex flex-col gap-4">
        {run&&<Card>
          <CardHeader><CardTitle><h2>{`parts2world turu · ${number(run.total)} ürün`}</h2></CardTitle><CardDescription className="tabular-nums">{number(run.processed)} / {number(run.total)} ürün işlendi</CardDescription><CardAction>{statusBadge(...runStates[run.state])}</CardAction></CardHeader>
          <CardContent className="flex flex-col gap-3"><Progress value={run.percent} aria-label="parts2world turu"/><p className="text-sm tabular-nums">{run.finished_at?`Kalan ${number(run.remaining)} ürün`:`Kalan ${number(run.remaining)} ürün · ${eta(run.hoursLeft)}${parts2world?.last_hour?` (saatte ${number(parts2world.last_hour)})`:""}`} · {number(run.errors)} hata</p></CardContent>
          <CardFooter className="text-sm text-muted-foreground tabular-nums">{`Başladı ${date(run.started_at)}${run.finished_at?` · bitti ${date(run.finished_at)}`:""} · son yanıt ${run.last?date(run.last):"henüz yok"}`}</CardFooter>
        </Card>}
        <Card>
          <CardHeader><CardTitle><h2>Toplanan veri</h2></CardTitle><CardDescription>Veriler PostgreSQL&apos;de, görseller özel MinIO alanında.</CardDescription></CardHeader>
          <CardContent><Table controls={false}><TableBody>{cards.map(card=><TableRow key={card.label}>
            <TableCell className="whitespace-normal"><div className="flex flex-col"><span className="flex items-center gap-2 font-medium"><card.icon className="size-4 text-muted-foreground" aria-hidden="true"/>{card.label}</span><span className="text-sm text-muted-foreground">{card.note}</span></div></TableCell>
            <TableCell className="text-right font-semibold tabular-nums">{number(card.value)}</TableCell>
          </TableRow>)}</TableBody></Table></CardContent>
        </Card>
      </div>
    </div>

    <Card role="region" aria-labelledby="enrichment-records">
      <CardHeader><CardTitle><h2 id="enrichment-records">Ürün kayıtları</h2></CardTitle><CardDescription>Her ana ürün bir kez listelenir; bağlı tedarikçi teklifleri aynı doğrulanmış veriyi kullanır.</CardDescription><CardAction><Badge variant="outline" className="tabular-nums">{number(data.total)} kayıt</Badge></CardAction></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Tabs value={data.filters.status}><ScrollArea><TabsList variant="line" aria-label="Zenginleştirme durumları">{tabs.map(([key,label,count])=><TabsTrigger key={key} value={key} nativeButton={false} render={<Link href={href({status:key,match:"all",page:"1"})} scroll={false}/>}>{label}<Badge variant="secondary" className="tabular-nums">{number(count)}</Badge></TabsTrigger>)}</TabsList><ScrollBar orientation="horizontal"/></ScrollArea></Tabs>
        <form key={`${data.filters.status}:${data.filters.match}:${data.filters.q}`} className="flex flex-wrap items-center gap-2" method="get">
          {(["status","sort","dir","source","name","code","brand","gap"] as const).map(key=>data.filters[key]&&<input key={key} type="hidden" name={key} value={data.filters[key]}/>)}
          <InputGroup className="w-full sm:w-96"><InputGroupAddon><Search aria-hidden="true"/></InputGroupAddon><InputGroupInput name="q" aria-label="Ürün, marka veya OEM ara" defaultValue={data.filters.q} placeholder="Ürün kodu, marka veya OEM ara…"/></InputGroup>
          <NativeSelect aria-label="Eşleşme yöntemi" name="match" defaultValue={data.filters.match}><NativeSelectOption value="all">Tüm eşleşme yöntemleri</NativeSelectOption><NativeSelectOption value="oem_reference">OEM referansıyla</NativeSelectOption><NativeSelectOption value="exact_part">Doğrudan marka / parça</NativeSelectOption><NativeSelectOption value="cross_reference">Muadil referansıyla</NativeSelectOption></NativeSelect>
          <Button type="submit">Filtrele</Button>
          {(data.filters.q||data.filters.match!=="all")&&<Button variant="ghost" nativeButton={false} render={<Link href={href({q:"",match:"all",page:"1"})}/>}>Temizle</Button>}
        </form>
        {data.filters.status==="partial"&&<Alert variant="info"><Info aria-hidden="true"/><AlertTitle>Kısmi veri mağazada yayında</AlertTitle><AlertDescription>Eşleşme doğrulandı; görsel, OEM ve özellikler ürün sayfasında görünür ve bu ürünler &quot;Zenginleştirilen&quot; sayısına dahildir. Neden Durum başlığındaki filtreden seçilir. Kendiliğinden kapanabilen: <strong>Görsel yok</strong> (saatlik yedek görev otoparcasan ve spareto&apos;dan görsel arar). Kaynak sınırı olanlar: <strong>Araç listesi yok</strong> (kaynakta uyumluluk tablosu yok), <strong>Araçların bir kısmı eşleşmedi</strong> (kaynağın saydığı bazı araç kimlikleri kendi sayfalarında yok; yeniden deneme 22 Ekim&apos;de 305 üründe sonuç vermedi) ve <strong>Geçersiz araç satırı</strong> (kaynak yalnız yıl veriyor, sözleşme ay/yıl ister). Elle yapılacak bir işlem yoktur.</AlertDescription></Alert>}
        {data.rows.length?<Table server><TableHeader><TableRow>
          <TableHead sortKey="name" filter={{param:"name",placeholder:"Ürün adı içeren…"}}>Ürün</TableHead>
          <TableHead sortKey="brand" filter={{param:"brand",options:data.brands}}>Marka</TableHead>
          <TableHead sortKey="code" filter={{param:"code",placeholder:"Kod içeren…"}}>Kod</TableHead>
          <TableHead sortKey="status" filter={data.gaps?{param:"gap",options:(Object.keys(gapLabels) as PartialGap[]).filter(key=>data.gaps![key]).map(key=>({value:key,label:gapLabels[key],count:data.gaps![key]}))}:undefined}>Durum</TableHead>
          <TableHead sortKey="source" filter={{param:"source",options:sourceOptions}}>Kaynak</TableHead>
          <TableHead sortKey="match" filter={{param:"match",options:matchOptions}}>Eşleşme</TableHead>
          <TableHead sortKey="oems" className="text-right">OEM</TableHead>
          <TableHead sortKey="vehicles" className="text-right">Araç</TableHead>
          <TableHead sortKey="specs" className="text-right">Özellik</TableHead>
          <TableHead sortKey="updated">Son işlem</TableHead>
          <TableHead><span className="sr-only">Ayrıntılar</span></TableHead>
        </TableRow></TableHeader><TableBody>{data.rows.map(row=>{const source=dataSource(row.source_url),others=row.searched.filter(key=>key!==source),gaps=gapText(row);
          return <TableRow key={row.id}>
          <TableCell className="max-w-56" value={row.name||row.code}><Link className="block truncate font-medium hover:underline" href={`/yonetim/urunler/${row.product_id}`} title={row.name||row.code}>{row.name||row.code}</Link></TableCell>
          <TableCell className="max-w-32"><span className="block truncate" title={row.brand}>{row.brand}</span></TableCell>
          <TableCell className="max-w-36 font-mono text-sm"><span className="block truncate" title={row.code}>{row.code}</span></TableCell>
          <TableCell value={enrichmentStatuses[row.status]||row.status}><span title={gaps||undefined}>{statusBadge(enrichmentStatusTones[row.status]??"neutral",enrichmentStatuses[row.status]||row.status)}</span></TableCell>
          <TableCell value={source?sourceLabels[source].name:""}>{source?<span title={others.length?`Ayrıca arandı: ${sourceNames(others)}`:undefined}>{sourceLabels[source].name}</span>
            :<span className="text-muted-foreground" title={others.length?`Arandı: ${sourceNames(others)}`:undefined}>{others.length?`Arandı: ${sourceNames(others)}`:"Henüz aranmadı"}</span>}</TableCell>
          <TableCell value={row.match_type?matchLabels[row.match_type]:""}>{row.match_type?<span title={row.match_type==="cross_reference"||!row.reference?`${row.manufacturer} ${row.manufacturer_part_number}`:row.reference}>{matchLabels[row.match_type]}</span>:<span className="text-muted-foreground">—</span>}</TableCell>
          <TableCell className="text-right tabular-nums">{number(row.oem_count)}</TableCell>
          <TableCell className="text-right tabular-nums">{number(row.vehicle_count)}</TableCell>
          <TableCell className="text-right tabular-nums">{number(row.specification_count)}</TableCell>
          <TableCell className="tabular-nums"><time dateTime={(row.imported_at||row.updated_at).toISOString()} title={`${row.attempts} deneme`}>{date(row.imported_at||row.updated_at)}</time></TableCell>
          <TableCell className="text-right"><EnrichmentDetails name={row.name} code={row.code} productId={row.id}/></TableCell>
        </TableRow>;})}</TableBody></Table>:<Empty><EmptyHeader><EmptyMedia variant="icon"><Search/></EmptyMedia><EmptyTitle>Bu filtrelerle kayıt bulunamadı</EmptyTitle><EmptyDescription>Arama kodunu veya eşleşme yöntemini değiştirerek tekrar dene.</EmptyDescription></EmptyHeader><EmptyContent><Button variant="outline" nativeButton={false} render={<Link href="/yonetim/urun-verileri"/>}>Tüm zenginleştirilen ürünler</Button></EmptyContent></Empty>}
      </CardContent>
      <CardFooter className="flex-col gap-2 text-sm text-muted-foreground tabular-nums sm:flex-row"><span className="shrink-0">{data.total?`${number((data.page-1)*data.pageSize+1)}–${number(Math.min(data.page*data.pageSize,data.total))}`:"0"} / {number(data.total)} kayıt · Sayfa {number(data.page)} / {number(data.pages)}</span>
        {(prev||next)&&<Pagination aria-label="Sayfalama" className="sm:justify-end"><PaginationContent>{prev&&<PaginationItem><Button variant="ghost" aria-label="Önceki sayfa" nativeButton={false} render={<Link href={prev} scroll={false}/>}><ChevronLeft data-icon="inline-start" aria-hidden="true"/>Önceki</Button></PaginationItem>}{next&&<PaginationItem><Button variant="ghost" aria-label="Sonraki sayfa" nativeButton={false} render={<Link href={next} scroll={false}/>}>Sonraki<ChevronRight data-icon="inline-end" aria-hidden="true"/></Button></PaginationItem>}</PaginationContent></Pagination>}
      </CardFooter>
    </Card>

  </div>;
}
