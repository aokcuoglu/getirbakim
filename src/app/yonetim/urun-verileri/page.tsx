import Link from "next/link";
import { EnrichmentDetails } from "@/components/admin/enrichment-details";
import { EnrichmentRefresh } from "@/components/admin/enrichment-refresh";
import { ChevronLeft, ChevronRight, ArrowDownToLine, ArrowUpRight, Check, CircleAlert, CircleCheck, CircleHelp, Clock3, Database, ImageIcon, Info, Layers3, Search, ShieldCheck, GitCompareArrows, CarFront, TriangleAlert, type LucideIcon } from "lucide-react";
import { requireAdmin } from "@/modules/auth/session";
import { enrichmentDashboard, enrichmentStatuses } from "@/modules/admin/enrichment-data";
import { passForecast } from "@/modules/admin/enrichment-pace";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const pilotStatuses:Record<string,string>={prepared:"Hazır",running:"Çalışıyor",complete:"Bitti",blocked:"Kaynak nedeniyle durdu",stopped:"Durduruldu"};
const number=(value:number)=>new Intl.NumberFormat("tr-TR").format(value);
type Tone="success"|"info"|"warning"|"error"|"neutral";
const tones:Record<Tone,{variant:"secondary"|"outline"|"destructive";icon?:LucideIcon}>={success:{variant:"secondary",icon:CircleCheck},info:{variant:"outline",icon:Info},warning:{variant:"outline",icon:TriangleAlert},error:{variant:"destructive",icon:CircleAlert},neutral:{variant:"outline"}};
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
  const sourceState=data.pass.blocked?"Kaynak bloke — koşu durdu":data.pass.challenge_since?`Cloudflare doğrulaması bekleniyor (${date(data.pass.challenge_since)} itibarıyla)`:"Kaynak erişilebilir";
  const href=(changes:Record<string,string>)=>{
    const params=new URLSearchParams({...data.filters,...changes});
    for(const [key,value] of [...params])if(!value||value==="all"||value==="enriched")params.delete(key);
    return `/yonetim/urun-verileri${params.size?`?${params}`:""}`;
  };
  const cards=[
    {label:"Zenginleştirilen ürün",value:data.metrics.enriched,icon:Layers3,note:`${number(counts.complete||0)} tamamlandı · ${number(counts.partial||0)} kısmi`},
    {label:"OEM referansıyla eşleşen",value:data.metrics.oem_matches,icon:GitCompareArrows,note:`${number(data.metrics.direct_matches)} doğrudan marka / parça eşleşmesi`},
    {label:"Araç / motor kaydı",value:data.metrics.vehicles,icon:CarFront,note:`${number(data.metrics.oem_numbers)} OEM referansı toplandı`},
    {label:"Görseli bulunan ürün",value:data.metrics.images,icon:ImageIcon,note:`${(Number(data.metrics.bytes)/1024/1024).toLocaleString("tr-TR",{maximumFractionDigits:1})} MB görsel depolanıyor`},
  ];
  const statusTones:Record<string,Tone>={complete:"success",partial:"info",review:"warning",failed:"error",blocked:"error",not_found:"neutral",pending:"neutral"};
  const tabs:[string,string,number][]=[["enriched","Zenginleştirilen",data.metrics.enriched],["review","İnceleme",counts.review||0],["partial","Kısmi veri",counts.partial||0],["not_found","Eşleşmeyen",counts.not_found||0],["pending","Bekleyen",counts.pending||0]];
  const prev=data.page>1?href({page:String(data.page-1)}):null, next=data.page<data.pages?href({page:String(data.page+1)}):null;
  return <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink render={<Link href="/yonetim"/>}>Yönetim</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator/><BreadcrumbItem><BreadcrumbPage>Ürün zenginleştirme</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-2xl font-semibold tracking-tight">Ürün zenginleştirme</h1><p className="text-muted-foreground">Parçaların bilgiye dönüşümünü tek yerden takip et.</p></div>
        <div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className="hidden lg:inline-flex"><Database data-icon="inline-start"/>Veritabanından güncel görünüm</Badge><EnrichmentRefresh/></div>
      </div>
    </div>
    <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Zenginleştirme özeti">{cards.map(card=><Card key={card.label}>
      <CardHeader><dt><CardDescription>{card.label}</CardDescription></dt><dd><CardTitle className="text-2xl font-semibold tabular-nums">{number(card.value)}</CardTitle></dd><CardAction><card.icon className="size-4 text-muted-foreground" aria-hidden="true"/></CardAction></CardHeader>
      <CardFooter className="text-sm text-muted-foreground">{card.note}</CardFooter>
    </Card>)}</dl>

    <div className="grid items-start gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader><CardTitle><h2>Katalog kapsamı</h2></CardTitle><CardDescription>{number(attempted)} / {number(total)} ürün incelendi</CardDescription><CardAction><Badge variant="secondary" className="tabular-nums">%{total?((attempted/total)*100).toLocaleString("tr-TR",{maximumFractionDigits:2}):0}</Badge></CardAction></CardHeader>
        <CardContent><Progress value={total?attempted/total*100:0} aria-label="İncelenen ürünler"/></CardContent>
        <CardFooter className="flex-wrap justify-between gap-2 text-sm text-muted-foreground"><span className="flex items-center gap-2"><Clock3 className="size-4" aria-hidden="true"/>{number(counts.pending||0)} ürün henüz incelenmedi</span><span>Son aktarım: {data.metrics.latest?date(data.metrics.latest):"Henüz yok"}</span></CardFooter>
      </Card>
      <Item variant="outline" render={<Link href={href({status:"attention",match:"all",q:"",page:"1"})}/>}>
        <ItemMedia variant="icon"><CircleHelp/></ItemMedia>
        <ItemContent><ItemTitle>Kontrol bekleyen kayıtlar · <span className="tabular-nums">{number(attention)}</span></ItemTitle><ItemDescription>{number(counts.review||0)} inceleme · {number((counts.blocked||0)+(counts.failed||0))} erişim / işlem hatası</ItemDescription></ItemContent>
        <ItemActions><ArrowUpRight className="size-4" aria-hidden="true"/></ItemActions>
      </Item>
    </div>

    <Card>
      <CardHeader><CardTitle><h2>Katalog turu hızı</h2></CardTitle><CardDescription>Son 24 saat</CardDescription><CardAction><Badge variant="secondary" className="tabular-nums">{days(forecast.daysLeft)}</Badge></CardAction></CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <p className="text-muted-foreground"><span className="font-semibold text-foreground tabular-nums">{number(data.pass.finished_24h)}</span> ürün arandı · çalışırken saatte {number(Math.round(forecast.perActiveHour))}</p>
        <p>Tarayıcı son 24 saatin {hours(forecast.activeHours)} saatinde çalıştı (%{Math.round(forecast.uptime*100)}). Kalan {number(counts.pending||0)} ürün bu hızla {days(forecast.daysLeft)}, kesintisiz çalışırsa {days(forecast.daysLeftAlwaysOn)} sürer.</p>
      </CardContent>
      <CardFooter className="flex-wrap justify-between gap-3 text-sm text-muted-foreground"><span className="tabular-nums">{number(data.pass.linked_products)} ürün araç kataloğuna bağlı</span><span className="flex items-center gap-2">{statusBadge(data.pass.blocked?"error":data.pass.challenge_since?"warning":"success",sourceState)}{data.pass.interval_ms?<span className="tabular-nums">istek aralığı {hours(data.pass.interval_ms/1000)} sn</span>:null}</span></CardFooter>
    </Card>

    {data.pilot&&<Card>
      <CardHeader><CardTitle><h2>{`${number(data.pilot.sample_size)} ürünlük pilot`}</h2></CardTitle><CardDescription>{number(data.pilot.processed)} / {number(data.pilot.sample_size)} ürün işlendi</CardDescription><CardAction>{statusBadge(data.pilot.status==="running"?"info":data.pilot.status==="complete"?"success":data.pilot.status==="blocked"?"error":"neutral",pilotStatuses[data.pilot.status]||data.pilot.status)}</CardAction></CardHeader>
      <CardContent className="flex flex-col gap-3"><Progress value={data.pilot.processed/data.pilot.sample_size*100} aria-label="Pilot ürünleri"/><p className="text-sm tabular-nums">{number(data.pilot.complete)} tamamlandı · {number(data.pilot.partial)} kısmi · {number(data.pilot.review)} inceleme · {number(data.pilot.not_found)} eşleşmeyen · {number(data.pilot.failed)} hata</p></CardContent>
      <CardFooter className="flex-wrap justify-between gap-3 text-sm text-muted-foreground"><span className="tabular-nums">{number(data.pilot.requests)} kaynak isteği · {number(data.pilot.cache_hits)} önbellek kullanımı · {number(data.pilot.rate_limits)} hız sınırı yanıtı</span><span>{data.pilot.last_response?`Son kaynak yanıtı: ${date(data.pilot.last_response)}`:"Tarayıcı bağlantısı bekleniyor"}</span></CardFooter>
    </Card>}

    <Card role="region" aria-labelledby="enrichment-records">
      <CardHeader><CardTitle><h2 id="enrichment-records">Ürün kayıtları</h2></CardTitle><CardDescription>Eşleşmeleri ve veri kapsamını ürün bazında incele.</CardDescription><CardAction><Badge variant="outline" className="tabular-nums">{number(data.total)} kayıt</Badge></CardAction></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Tabs value={data.filters.status}><TabsList variant="line" aria-label="Zenginleştirme durumları">{tabs.map(([key,label,count])=><TabsTrigger key={key} value={key} nativeButton={false} render={<Link href={href({status:key,match:"all",page:"1"})} scroll={false}/>}>{label}<Badge variant="secondary" className="tabular-nums">{number(count)}</Badge></TabsTrigger>)}</TabsList></Tabs>
        <form key={`${data.filters.status}:${data.filters.match}:${data.filters.q}`} className="flex flex-wrap items-center gap-2" method="get">
          <InputGroup className="w-full sm:w-96"><InputGroupAddon><Search aria-hidden="true"/></InputGroupAddon><InputGroupInput name="q" aria-label="Ürün, marka veya OEM ara" defaultValue={data.filters.q} placeholder="Ürün kodu, marka veya OEM ara…"/></InputGroup>
          <NativeSelect aria-label="Kayıt durumu" name="status" defaultValue={data.filters.status}><NativeSelectOption value="enriched">Zenginleştirilen ürünler</NativeSelectOption><NativeSelectOption value="attention">Kontrol bekleyen tüm kayıtlar</NativeSelectOption>{Object.entries(enrichmentStatuses).map(([key,label])=><NativeSelectOption key={key} value={key}>{label}</NativeSelectOption>)}</NativeSelect>
          <NativeSelect aria-label="Eşleşme yöntemi" name="match" defaultValue={data.filters.match}><NativeSelectOption value="all">Tüm eşleşme yöntemleri</NativeSelectOption><NativeSelectOption value="oem_reference">OEM referansıyla</NativeSelectOption><NativeSelectOption value="exact_part">Doğrudan marka / parça</NativeSelectOption></NativeSelect>
          <Button type="submit">Filtrele</Button>
          {(data.filters.q||data.filters.match!=="all")&&<Button variant="ghost" nativeButton={false} render={<Link href={href({q:"",match:"all",page:"1"})}/>}>Temizle</Button>}
        </form>
        {data.rows.length?<Table><TableHeader><TableRow><TableHead>Ürün / tedarikçi kodu</TableHead><TableHead>Durum</TableHead><TableHead>Eşleşme</TableHead><TableHead>Toplanan veriler</TableHead><TableHead>Son işlem</TableHead><TableHead><span className="sr-only">Ayrıntılar</span></TableHead></TableRow></TableHeader><TableBody>{data.rows.map(row=><TableRow key={row.id}>
          <TableCell><div className="flex max-w-80 items-center gap-3">
            <Avatar>{row.image_id?<AvatarImage src={`/api/product-media/${row.image_id}`} alt=""/>:null}<AvatarFallback><ImageIcon className="size-4" aria-hidden="true"/></AvatarFallback></Avatar>
            <div className="min-w-0"><Link className="block truncate font-medium hover:underline" href={`/urun/${row.id}`}>{row.name||row.code}</Link><div className="text-sm text-muted-foreground">{row.brand} · <span className="font-mono">{row.code}</span></div></div>
          </div></TableCell>
          <TableCell>{statusBadge(statusTones[row.status]??"neutral",enrichmentStatuses[row.status]||row.status)}</TableCell>
          <TableCell>{row.match_type?<div><span className="flex items-center gap-2">{row.match_type==="oem_reference"?<GitCompareArrows className="size-4 text-muted-foreground" aria-hidden="true"/>:<ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true"/>}{row.match_type==="oem_reference"?"OEM referansı":"Doğrudan eşleşme"}</span><div className="max-w-48 truncate font-mono text-sm text-muted-foreground">{row.reference||`${row.manufacturer} ${row.manufacturer_part_number}`}</div></div>:<span className="text-muted-foreground">Henüz doğrulanmadı</span>}</TableCell>
          <TableCell><div className="flex max-w-56 flex-wrap gap-1"><Badge variant="outline" className="tabular-nums" title="OEM referansı"><Database data-icon="inline-start"/>{number(row.oem_count)} OEM</Badge><Badge variant="outline" className="tabular-nums" title="Araç ve motor satırı"><CarFront data-icon="inline-start"/>{number(row.vehicle_count)} araç</Badge><Badge variant="outline" className="tabular-nums" title="Teknik özellik"><Layers3 data-icon="inline-start"/>{number(row.specification_count)} özellik</Badge></div></TableCell>
          <TableCell className="tabular-nums"><time dateTime={(row.imported_at||row.updated_at).toISOString()}>{date(row.imported_at||row.updated_at)}</time><div className="text-sm text-muted-foreground">{row.attempts} deneme</div></TableCell>
          <TableCell className="text-right"><EnrichmentDetails name={row.name} code={row.code} productId={row.id} footer={<>{row.source_url?<Button variant="outline" nativeButton={false} render={<Link href={row.source_url} target="_blank"/>}>{new URL(row.source_url).hostname}<ArrowUpRight data-icon="inline-end"/></Button>:<span className="text-sm text-muted-foreground sm:mr-auto">Henüz kaynak verisi kaydedilmedi.</span>}<Button nativeButton={false} render={<Link href={`/urun/${row.id}`}/>}>Ürün sayfasını aç<ArrowUpRight data-icon="inline-end"/></Button></>}>
            <Table><TableBody>{([["Durum",statusBadge(statusTones[row.status]??"neutral",enrichmentStatuses[row.status]||row.status)],["Eşleşme yöntemi",row.match_type==="oem_reference"?"OEM referansı":row.match_type==="exact_part"?"Doğrudan marka / parça":"Henüz doğrulanmadı"],["Referans ürün",row.manufacturer?`${row.manufacturer} ${row.manufacturer_part_number}`:"Henüz yok"],["Tedarikçi OEM",row.oem||"Belirtilmemiş"],["Görsel",row.image_id?"Kaydedildi":"Henüz yok"],["Son işlem",`${date(row.imported_at||row.updated_at)} · ${row.attempts} deneme`]] as [string,React.ReactNode][]).map(([label,value])=><TableRow key={label}><TableHead>{label}</TableHead><TableCell className="whitespace-normal">{value}</TableCell></TableRow>)}</TableBody></Table>
            <div className="grid grid-cols-3 gap-2">{([[row.oem_count,"OEM referansı"],[row.vehicle_count,"araç / motor"],[row.specification_count,"teknik özellik"]] as const).map(([value,label])=><Item key={label} variant="muted"><ItemContent><ItemTitle className="text-xl tabular-nums">{number(value)}</ItemTitle><ItemDescription>{label}</ItemDescription></ItemContent></Item>)}</div>
            {row.last_error&&<Alert><TriangleAlert/><AlertDescription>Son işlem notu: {row.last_error}</AlertDescription></Alert>}
          </EnrichmentDetails></TableCell>
        </TableRow>)}</TableBody></Table>:<Empty><EmptyHeader><EmptyMedia variant="icon"><Search/></EmptyMedia><EmptyTitle>Bu filtrelerle kayıt bulunamadı</EmptyTitle><EmptyDescription>Arama kodunu veya eşleşme yöntemini değiştirerek tekrar dene.</EmptyDescription></EmptyHeader><EmptyContent><Button variant="outline" nativeButton={false} render={<Link href="/yonetim/urun-verileri"/>}>Tüm zenginleştirilen ürünler</Button></EmptyContent></Empty>}
      </CardContent>
      <CardFooter className="flex-col gap-2 text-sm text-muted-foreground tabular-nums sm:flex-row"><span className="shrink-0">{data.total?`${number((data.page-1)*data.pageSize+1)}–${number(Math.min(data.page*data.pageSize,data.total))}`:"0"} / {number(data.total)} kayıt · Sayfa {number(data.page)} / {number(data.pages)}</span>
        {(prev||next)&&<Pagination aria-label="Sayfalama" className="sm:justify-end"><PaginationContent>{prev&&<PaginationItem><Button variant="ghost" aria-label="Önceki sayfa" nativeButton={false} render={<Link href={prev} scroll={false}/>}><ChevronLeft data-icon="inline-start"/>Önceki</Button></PaginationItem>}{next&&<PaginationItem><Button variant="ghost" aria-label="Sonraki sayfa" nativeButton={false} render={<Link href={next} scroll={false}/>}>Sonraki<ChevronRight data-icon="inline-end"/></Button></PaginationItem>}</PaginationContent></Pagination>}
      </CardFooter>
    </Card>

    <section className="flex flex-col gap-4" aria-labelledby="enrichment-infrastructure">
      <div><h2 id="enrichment-infrastructure" className="text-lg font-semibold">Veri kaynağı ve depolama</h2><p className="text-sm text-muted-foreground">Kaynak bağlantısının kontrol sonucu ile kaydedilmiş verileri ayrı takip et.</p></div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle><h3>Kaynak erişimi</h3></CardTitle><CardDescription>Bu sonuç doğrudan HTTP kontrolüne aittir. Tarayıcı üzerinden yapılan aktarımlar yukarıdaki kayıtlarda görünür.</CardDescription><CardAction><ArrowDownToLine className="size-4 text-muted-foreground" aria-hidden="true"/></CardAction></CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {data.sources.map(source=><div key={source.host}><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{source.host}</span>{statusBadge(source.status==="blocked"?"warning":source.status==="accessible"?"success":"error",source.status==="blocked"?"Doğrudan erişim engelli":source.status==="accessible"?"Erişilebilir":"Bağlantı hatası")}</div><p className="text-muted-foreground">HTTP {source.http_status??"—"} · Kontrol: {date(source.checked_at)}</p></div>)}
            {!data.sources.length&&<p className="text-muted-foreground">Henüz kaynak kontrolü yapılmadı.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle><h3>Veri ve görsel arşivi</h3></CardTitle><CardDescription>Tedarikçi marka, kod ve fiyat bilgileri kendi kaynağında korunur.</CardDescription><CardAction><Database className="size-4 text-muted-foreground" aria-hidden="true"/></CardAction></CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
            <p className="flex items-center gap-2"><Check className="size-4" aria-hidden="true"/>OEM, özellik ve araç bilgileri PostgreSQL’de</p>
            <Separator/>
            <p className="flex items-center gap-2"><Check className="size-4" aria-hidden="true"/>Görseller özel MinIO alanında</p>
          </CardContent>
        </Card>
      </div>
    </section>
  </div>;
}
