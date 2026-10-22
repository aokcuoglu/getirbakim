import Link from "next/link";
import { EnrichmentDetails } from "@/components/admin/enrichment-details";
import { LiveRefresh } from "@/components/admin/live-refresh";
import { ChevronLeft, ChevronRight, ArrowUpRight, CircleAlert, CircleCheck, CircleHelp, Clock3, ImageIcon, Info, Layers3, Search, GitCompareArrows, CarFront, TriangleAlert, type LucideIcon } from "lucide-react";
import { requireAdmin } from "@/modules/auth/session";
import { enrichmentDashboard, enrichmentStatuses } from "@/modules/admin/enrichment-data";
import { partialGaps, passForecast, sourceHosts, type PartialGap, type SourceKey } from "@/modules/admin/enrichment-pace";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { Progress } from "@/components/ui/progress";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const sourceLabels:Record<string,{name:string;role:string}>={
  trodo:{name:"Trodo",role:"Bekleyen kuyruk · birincil kaynak"},
  otoparcasan:{name:"otoparcasan",role:"Eşleşmeyen + inceleme · saatlik yedek"},
  spareto:{name:"spareto",role:"Bekleyen kuyruk + saatlik yedek"},
};
// The source that wrote a product's data, from its source URL.
const dataSource=(url:string|null)=>url?(Object.keys(sourceHosts) as SourceKey[]).find(key=>sourceHosts[key]===new URL(url).hostname)??null:null;
const sourceNames=(keys:SourceKey[])=>keys.map(key=>sourceLabels[key].name).join(", ");
const sourceStates:Record<string,string>={running:"Çalışıyor",idle:"Beklemede",blocked:"Kaynak nedeniyle durdu"};
const pilotStatuses:Record<string,string>={prepared:"Hazır",running:"Çalışıyor",complete:"Bitti",blocked:"Kaynak nedeniyle durdu",stopped:"Durduruldu"};
const gapLabels:Record<PartialGap,string>={image:"Görsel yok",no_vehicles:"Araç listesi yok",vehicles_not_collected:"Araçlar toplanmadı",unresolved_vehicles:"Araçların bir kısmı eşleşmedi",invalid_rows:"Geçersiz araç satırı",failed_makes:"Bazı markaların araçları alınamadı"};
const gapText=(row:{status:string;source_method:string|null;image_id:string|null})=>row.status==="partial"?partialGaps(row.source_method,Boolean(row.image_id)).map(gap=>gapLabels[gap]).join(" · "):"";
const sourceOptions=[{value:"trodo",label:"Trodo"},{value:"otoparcasan",label:"otoparcasan"},{value:"spareto",label:"spareto"}];
const matchOptions=[{value:"oem_reference",label:"OEM referansıyla"},{value:"exact_part",label:"Doğrudan marka / parça"},{value:"cross_reference",label:"Muadil referansıyla"}];
const matchLabels:Record<string,string>={oem_reference:"OEM referansı",exact_part:"Doğrudan",cross_reference:"Muadil"};
const number=(value:number)=>new Intl.NumberFormat("tr-TR").format(value);
type Tone="success"|"info"|"warning"|"error"|"neutral";
const tones:Record<Tone,{variant:"success"|"info"|"warning"|"destructive"|"outline";icon?:LucideIcon}>={success:{variant:"success",icon:CircleCheck},info:{variant:"info",icon:Info},warning:{variant:"warning",icon:TriangleAlert},error:{variant:"destructive",icon:CircleAlert},neutral:{variant:"outline"}};
const statusBadge=(tone:Tone,label:React.ReactNode)=>{const {variant,icon:Icon}=tones[tone];return <Badge variant={variant}>{Icon&&<Icon data-icon="inline-start"/>}{label}</Badge>;};
const date=(value:Date)=>new Intl.DateTimeFormat("tr-TR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Istanbul"}).format(value);

export default async function ProductDataAdmin({searchParams}:{searchParams:Promise<SearchParams>}) {
  await requireAdmin();
  const data=await enrichmentDashboard(normalizeSearchParams(await searchParams));
  const counts=Object.fromEntries(data.counts.map(row=>[row.status,row.count]));
  const total=data.counts.reduce((sum,row)=>sum+row.count,0);
  const attempted=total-(counts.pending||0), attention=(counts.review||0)+(counts.blocked||0)+(counts.failed||0);
  const forecast=passForecast(data.pass,counts.pending||0);
  const days=(value:number|null)=>value===null?"—":value<1?"1 günden az":`~${number(Math.ceil(value))} gün`;
  const hours=(value:number)=>value.toLocaleString("tr-TR",{maximumFractionDigits:1});
  const href=(changes:Record<string,string>)=>{
    const params=new URLSearchParams({...data.filters,...changes});
    for(const [key,value] of [...params])if(!value||value==="all"||value==="enriched")params.delete(key);
    return `/yonetim/urun-verileri${params.size?`?${params}`:""}`;
  };
  const cards=[
    {label:"OEM referansıyla eşleşen",value:data.metrics.oem_matches,icon:GitCompareArrows,note:`${number(data.metrics.direct_matches)} doğrudan marka / parça eşleşmesi`},
    {label:"Araç / motor kaydı",value:data.metrics.vehicles,icon:CarFront,note:`${number(data.metrics.oem_numbers)} OEM referansı toplandı`},
    {label:"Görseli bulunan ürün",value:data.metrics.images,icon:ImageIcon,note:`${(Number(data.metrics.bytes)/1024/1024).toLocaleString("tr-TR",{maximumFractionDigits:1})} MB görsel depolanıyor`},
  ];
  const statusTones:Record<string,Tone>={complete:"success",partial:"warning",review:"warning",failed:"error",blocked:"error",not_found:"error",pending:"neutral"};
  const tabs:[string,string,number][]=[["enriched","Zenginleştirilen",data.metrics.enriched],["review","İnceleme",counts.review||0],["partial","Kısmi veri",counts.partial||0],["not_found","Eşleşmeyen",counts.not_found||0],["pending","Bekleyen",counts.pending||0]];
  const prev=data.page>1?href({page:String(data.page-1)}):null, next=data.page<data.pages?href({page:String(data.page+1)}):null;
  const trodo=data.sourceSummary.find(source=>source.source==="trodo");
  const percent=total?attempted/total*100:0;
  return <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink render={<Link href="/yonetim"/>}>Yönetim</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator/><BreadcrumbItem><BreadcrumbPage>Ürün zenginleştirme</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-2xl font-semibold tracking-tight">Ürün zenginleştirme</h1><p className="text-sm text-muted-foreground">Trodo, otoparcasan ve spareto&apos;dan toplanan görsel, OEM, özellik ve araç verileri. Son aktarım: {data.metrics.latest?date(data.metrics.latest):"henüz yok"}.</p></div>
        <LiveRefresh seconds={30}/>
      </div>
    </div>
    {data.pass.blocked?<Alert variant="destructive"><CircleAlert aria-hidden="true"/><AlertTitle>Trodo erişimi engellendi</AlertTitle><AlertDescription>Koşu durdu; engel kalkınca işçi yeniden başlatılmalı.</AlertDescription></Alert>
      :data.pass.challenge_since?<Alert variant="warning"><TriangleAlert aria-hidden="true"/><AlertTitle>Cloudflare doğrulaması bekleniyor</AlertTitle><AlertDescription>{date(data.pass.challenge_since)} itibarıyla Trodo sekmesinde doğrulama bekleniyor; tamamlanınca işlem kendiliğinden sürer.</AlertDescription></Alert>:null}

    <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Zenginleştirme özeti">
      <Card>
        <CardHeader><dt><CardDescription>Katalog kapsamı</CardDescription></dt><dd><CardTitle className="text-2xl tabular-nums">%{percent.toLocaleString("tr-TR",{maximumFractionDigits:2})}</CardTitle></dd><CardAction><Layers3 className="size-4 text-muted-foreground" aria-hidden="true"/></CardAction></CardHeader>
        <CardContent className="flex flex-col gap-2"><Progress value={percent} aria-label="İncelenen ürünler"/><span className="text-sm text-muted-foreground tabular-nums">{number(attempted)} / {number(total)} ürün incelendi</span></CardContent>
      </Card>
      <Card>
        <CardHeader><dt><CardDescription>Trodo hızı</CardDescription></dt><dd><CardTitle className="text-2xl tabular-nums">{number(Math.round(forecast.perActiveHour))} / saat</CardTitle></dd><CardAction><Clock3 className="size-4 text-muted-foreground" aria-hidden="true"/></CardAction></CardHeader>
        <CardContent className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
          {data.pass.blocked||trodo?.state==="blocked"?statusBadge("error","Durdu"):trodo?.state==="running"?statusBadge("success","Çalışıyor"):statusBadge("warning","Son 15 dk sessiz")}
          <span className="tabular-nums">Kalan {number(counts.pending||0)} ürün: {days(forecast.daysLeft)} (kesintisiz {days(forecast.daysLeftAlwaysOn)})</span>
          <span className="tabular-nums">Son 24 saatin {hours(forecast.activeHours)} saatinde çalıştı{data.pass.interval_ms?` · istek aralığı ${hours(data.pass.interval_ms/1000)} sn`:""}</span>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><dt><CardDescription>Zenginleştirilen ürün</CardDescription></dt><dd><CardTitle className="text-2xl tabular-nums">{number(data.metrics.enriched)}</CardTitle></dd><CardAction><CircleCheck className="size-4 text-muted-foreground" aria-hidden="true"/></CardAction></CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm text-muted-foreground tabular-nums"><span>{number(counts.complete||0)} tamamlandı · {number(counts.partial||0)} kısmi</span><span>Son 24 saatte {number(data.pass.finished_24h+data.pass.fallback_pending_found_24h)} ürün işlendi</span></CardContent>
      </Card>
      <Card>
        <CardHeader><dt><CardDescription>Kontrol bekleyen</CardDescription></dt><dd><CardTitle className="text-2xl tabular-nums">{number(attention)}</CardTitle></dd><CardAction><CircleHelp className="size-4 text-muted-foreground" aria-hidden="true"/></CardAction></CardHeader>
        <CardContent className="flex flex-col items-start gap-2 text-sm text-muted-foreground tabular-nums">
          <span>{number(counts.review||0)} inceleme · {number((counts.blocked||0)+(counts.failed||0))} erişim / işlem hatası</span>
          {attention?<Button variant="outline" size="sm" nativeButton={false} render={<Link href={href({status:"attention",match:"all",q:"",page:"1"})} scroll={false}/>}>Kayıtları aç<ArrowUpRight data-icon="inline-end"/></Button>:null}
        </CardContent>
      </Card>
    </dl>

    <div className="grid items-start gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardHeader><CardTitle><h2>Veri kaynakları</h2></CardTitle><CardDescription>Son 24 saatteki aramalar; son 15 dakikada arama yapan kaynak çalışıyor sayılır.</CardDescription></CardHeader>
        <CardContent>
          <Table controls={false}><TableHeader><TableRow><TableHead>Kaynak</TableHead><TableHead>Durum</TableHead><TableHead className="text-right">Aranan</TableHead><TableHead className="text-right">Bulunan</TableHead><TableHead className="text-right">İsabet</TableHead><TableHead className="text-right">Toplam ürün</TableHead><TableHead>Son arama</TableHead></TableRow></TableHeader>
            <TableBody>{data.sourceSummary.map(source=><TableRow key={source.source}>
              <TableCell><div className="flex flex-col"><span className="font-medium">{sourceLabels[source.source].name}</span><span className="text-sm text-muted-foreground">{sourceLabels[source.source].role}</span></div></TableCell>
              <TableCell>{statusBadge(source.state==="running"?"success":source.state==="blocked"?"error":"neutral",sourceStates[source.state])}</TableCell>
              <TableCell className="text-right tabular-nums">{number(source.searched)}</TableCell>
              <TableCell className="text-right tabular-nums">{number(source.found)}</TableCell>
              <TableCell className="text-right tabular-nums">{source.hitRate===null?"—":`%${Math.round(source.hitRate*100)}`}</TableCell>
              <TableCell className="text-right tabular-nums">{number(source.written)}</TableCell>
              <TableCell className="tabular-nums text-muted-foreground">{source.last?date(source.last):"Henüz yok"}</TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </CardContent>
      </Card>
      <div className="flex flex-col gap-4">
        {data.pilot&&<Card>
          <CardHeader><CardTitle><h2>{`Trodo partisi · ${number(data.pilot.sample_size)} ürün`}</h2></CardTitle><CardDescription className="tabular-nums">{number(data.pilot.processed)} / {number(data.pilot.sample_size)} ürün işlendi</CardDescription><CardAction>{statusBadge(data.pilot.status==="running"?"info":data.pilot.status==="complete"?"success":data.pilot.status==="blocked"?"error":"neutral",pilotStatuses[data.pilot.status]||data.pilot.status)}</CardAction></CardHeader>
          <CardContent className="flex flex-col gap-3"><Progress value={data.pilot.sample_size?data.pilot.processed/data.pilot.sample_size*100:0} aria-label="Parti ürünleri"/><p className="text-sm tabular-nums">{number(data.pilot.complete)} tamamlandı · {number(data.pilot.partial)} kısmi · {number(data.pilot.review)} inceleme · {number(data.pilot.not_found)} eşleşmeyen · {number(data.pilot.failed)} hata{data.pilot.skipped>0&&` · ${number(data.pilot.skipped)} kapsam dışı`}</p></CardContent>
          <CardFooter className="text-sm text-muted-foreground tabular-nums">{data.pilot.last_response?`Son yanıt ${date(data.pilot.last_response)} · ${number(data.pilot.requests)} istek · ${number(data.pilot.cache_hits)} önbellek`:"Tarayıcı bağlantısı bekleniyor"}</CardFooter>
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
          {(["sort","dir","source","name","code","brand","gap"] as const).map(key=>data.filters[key]&&<input key={key} type="hidden" name={key} value={data.filters[key]}/>)}
          <InputGroup className="w-full sm:w-96"><InputGroupAddon><Search aria-hidden="true"/></InputGroupAddon><InputGroupInput name="q" aria-label="Ürün, marka veya OEM ara" defaultValue={data.filters.q} placeholder="Ürün kodu, marka veya OEM ara…"/></InputGroup>
          <NativeSelect aria-label="Kayıt durumu" name="status" defaultValue={data.filters.status}><NativeSelectOption value="enriched">Zenginleştirilen ürünler</NativeSelectOption><NativeSelectOption value="attention">Kontrol bekleyen tüm kayıtlar</NativeSelectOption>{Object.entries(enrichmentStatuses).map(([key,label])=><NativeSelectOption key={key} value={key}>{label}</NativeSelectOption>)}</NativeSelect>
          <NativeSelect aria-label="Eşleşme yöntemi" name="match" defaultValue={data.filters.match}><NativeSelectOption value="all">Tüm eşleşme yöntemleri</NativeSelectOption><NativeSelectOption value="oem_reference">OEM referansıyla</NativeSelectOption><NativeSelectOption value="exact_part">Doğrudan marka / parça</NativeSelectOption><NativeSelectOption value="cross_reference">Muadil referansıyla</NativeSelectOption></NativeSelect>
          <Button type="submit">Filtrele</Button>
          {(data.filters.q||data.filters.match!=="all")&&<Button variant="ghost" nativeButton={false} render={<Link href={href({q:"",match:"all",page:"1"})}/>}>Temizle</Button>}
        </form>
        {data.filters.status==="partial"&&<Alert variant="info"><Info aria-hidden="true"/><AlertTitle>Kısmi veri mağazada yayında</AlertTitle><AlertDescription>Eşleşme doğrulandı; görsel, OEM ve özellikler ürün sayfasında görünür ve bu ürünler &quot;Zenginleştirilen&quot; sayısına dahildir. Neden Durum başlığındaki filtreden seçilir. Kendiliğinden kapanabilenler: <strong>Görsel yok</strong> (saatlik yedek görev otoparcasan ve spareto&apos;dan görsel arar) ve <strong>Araçların bir kısmı eşleşmedi</strong> (Trodo yeniden denemesi). Kaynak sınırı olanlar: <strong>Araç listesi yok</strong> (kaynakta uyumluluk tablosu yok) ve <strong>Geçersiz araç satırı</strong> (kaynak yalnız yıl veriyor, sözleşme ay/yıl ister). Elle yapılacak bir işlem yoktur.</AlertDescription></Alert>}
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
          <TableCell value={enrichmentStatuses[row.status]||row.status}><span title={gaps||undefined}>{statusBadge(statusTones[row.status]??"neutral",enrichmentStatuses[row.status]||row.status)}</span></TableCell>
          <TableCell value={source?sourceLabels[source].name:""}>{source?<span title={others.length?`Ayrıca arandı: ${sourceNames(others)}`:undefined}>{sourceLabels[source].name}</span>
            :<span className="text-muted-foreground" title={others.length?`Arandı: ${sourceNames(others)}`:undefined}>{others.length?`Arandı: ${sourceNames(others)}`:"Henüz aranmadı"}</span>}</TableCell>
          <TableCell value={row.match_type?matchLabels[row.match_type]:""}>{row.match_type?<span title={row.match_type==="cross_reference"||!row.reference?`${row.manufacturer} ${row.manufacturer_part_number}`:row.reference}>{matchLabels[row.match_type]}</span>:<span className="text-muted-foreground">—</span>}</TableCell>
          <TableCell className="text-right tabular-nums">{number(row.oem_count)}</TableCell>
          <TableCell className="text-right tabular-nums">{number(row.vehicle_count)}</TableCell>
          <TableCell className="text-right tabular-nums">{number(row.specification_count)}</TableCell>
          <TableCell className="tabular-nums"><time dateTime={(row.imported_at||row.updated_at).toISOString()} title={`${row.attempts} deneme`}>{date(row.imported_at||row.updated_at)}</time></TableCell>
          <TableCell className="text-right"><EnrichmentDetails name={row.name} code={row.code} productId={row.id} footer={<>{row.source_url?<Button variant="outline" nativeButton={false} render={<Link href={row.source_url} target="_blank"/>}>{new URL(row.source_url).hostname}<ArrowUpRight data-icon="inline-end"/></Button>:<span className="text-sm text-muted-foreground sm:mr-auto">Henüz kaynak verisi kaydedilmedi.</span>}<Button nativeButton={false} render={<Link href={`/urun/${row.id}`}/>}>Ürün sayfasını aç<ArrowUpRight data-icon="inline-end"/></Button></>}>
            <Table><TableBody>{([["Durum",statusBadge(statusTones[row.status]??"neutral",enrichmentStatuses[row.status]||row.status)],["Eşleşme yöntemi",row.match_type?matchLabels[row.match_type]:"Henüz doğrulanmadı"],["Referans ürün",row.manufacturer?`${row.manufacturer} ${row.manufacturer_part_number}`:"Henüz yok"],["Veri kaynağı",source?sourceLabels[source].name:"Henüz yok"],["Aranan kaynaklar",row.searched.length?sourceNames(row.searched):"Henüz aranmadı"],...(row.status==="partial"?[["Eksik veri",gaps||"Belirtilmemiş"]]:[]),["Tedarikçi OEM",row.oem||"Belirtilmemiş"],["Görsel",row.image_id?"Kaydedildi":"Henüz yok"],["Son işlem",`${date(row.imported_at||row.updated_at)} · ${row.attempts} deneme`]] as [string,React.ReactNode][]).map(([label,value])=><TableRow key={label}><TableHead>{label}</TableHead><TableCell className="whitespace-normal">{value}</TableCell></TableRow>)}</TableBody></Table>
            <div className="grid grid-cols-3 gap-2">{([[row.oem_count,"OEM referansı"],[row.vehicle_count,"araç / motor"],[row.specification_count,"teknik özellik"]] as const).map(([value,label])=><Item key={label} variant="muted"><ItemContent><ItemTitle className="text-xl tabular-nums">{number(value)}</ItemTitle><ItemDescription>{label}</ItemDescription></ItemContent></Item>)}</div>
            {row.last_error&&<Alert variant="warning"><TriangleAlert/><AlertDescription>Son işlem notu: {row.last_error}</AlertDescription></Alert>}
          </EnrichmentDetails></TableCell>
        </TableRow>;})}</TableBody></Table>:<Empty><EmptyHeader><EmptyMedia variant="icon"><Search/></EmptyMedia><EmptyTitle>Bu filtrelerle kayıt bulunamadı</EmptyTitle><EmptyDescription>Arama kodunu veya eşleşme yöntemini değiştirerek tekrar dene.</EmptyDescription></EmptyHeader><EmptyContent><Button variant="outline" nativeButton={false} render={<Link href="/yonetim/urun-verileri"/>}>Tüm zenginleştirilen ürünler</Button></EmptyContent></Empty>}
      </CardContent>
      <CardFooter className="flex-col gap-2 text-sm text-muted-foreground tabular-nums sm:flex-row"><span className="shrink-0">{data.total?`${number((data.page-1)*data.pageSize+1)}–${number(Math.min(data.page*data.pageSize,data.total))}`:"0"} / {number(data.total)} kayıt · Sayfa {number(data.page)} / {number(data.pages)}</span>
        {(prev||next)&&<Pagination aria-label="Sayfalama" className="sm:justify-end"><PaginationContent>{prev&&<PaginationItem><Button variant="ghost" aria-label="Önceki sayfa" nativeButton={false} render={<Link href={prev} scroll={false}/>}><ChevronLeft data-icon="inline-start"/>Önceki</Button></PaginationItem>}{next&&<PaginationItem><Button variant="ghost" aria-label="Sonraki sayfa" nativeButton={false} render={<Link href={next} scroll={false}/>}>Sonraki<ChevronRight data-icon="inline-end"/></Button></PaginationItem>}</PaginationContent></Pagination>}
      </CardFooter>
    </Card>

  </div>;
}
