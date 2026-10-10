import Link from "next/link";
import Image from "next/image";
import { EnrichmentDetails } from "@/components/admin/enrichment-details";
import { EnrichmentRefresh } from "@/components/admin/enrichment-refresh";
import { ArrowDownToLine, ArrowUpRight, Check, ChevronLeft, ChevronRight, CircleHelp, Clock3, Database, ImageIcon, Layers3, Search, ShieldCheck, GitCompareArrows, CarFront } from "lucide-react";
import { requireAdmin } from "@/modules/auth/session";
import { enrichmentDashboard, enrichmentStatuses } from "@/modules/admin/enrichment-data";
import { passForecast } from "@/modules/admin/enrichment-pace";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { AdminColumns, AdminPage, AdminPageHeader, AdminPanel, AdminTabs, ButtonLink, EmptyState, PagerLink, Stat, StatGrid, StatusBadge, StatusMessage } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const pilotStatuses:Record<string,string>={prepared:"Hazır",running:"Çalışıyor",complete:"Bitti",blocked:"Kaynak nedeniyle durdu",stopped:"Durduruldu"};
const number=(value:number)=>new Intl.NumberFormat("tr-TR").format(value);
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
  const statusTones:Record<string,"success"|"info"|"warning"|"error"|"neutral">={complete:"success",partial:"info",review:"warning",failed:"error",blocked:"error",not_found:"neutral",pending:"neutral"};
  const tabs:[string,string,number][]=[["enriched","Zenginleştirilen",data.metrics.enriched],["review","İnceleme",counts.review||0],["partial","Kısmi veri",counts.partial||0],["not_found","Eşleşmeyen",counts.not_found||0],["pending","Bekleyen",counts.pending||0]];
  return <AdminPage>
    <AdminPageHeader breadcrumbs={[{label:"Yönetim",href:"/yonetim"},{label:"Ürün zenginleştirme"}]} title="Ürün zenginleştirme" description="Parçaların bilgiye dönüşümünü tek yerden takip et."
      actions={<><span className="hidden items-center gap-2 text-xs text-muted-foreground lg:flex"><span className="size-1.5 rounded-full bg-success ring-3 ring-success/20"/>Veritabanından güncel görünüm</span><EnrichmentRefresh/></>}/>
    <StatGrid label="Zenginleştirme özeti">{cards.map(card=><Stat key={card.label} icon={card.icon} label={card.label} value={number(card.value)} note={card.note}/>)}</StatGrid>

    <AdminColumns wide>
      <AdminPanel title="Katalog kapsamı" actions={<span className="text-xs text-muted-foreground tabular-nums">{number(total)} ürün</span>}>
        <div className="mb-2 flex items-baseline justify-between"><p className="text-sm text-muted-foreground"><strong className="text-xl font-semibold text-foreground tabular-nums">{number(attempted)}</strong> ürün incelendi</p><span className="font-semibold text-primary tabular-nums">%{total?((attempted/total)*100).toLocaleString("tr-TR",{maximumFractionDigits:2}):0}</span></div>
        <Progress value={total?attempted/total*100:0} aria-label="İncelenen ürünler"/>
        <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><Clock3 className="size-3.5" aria-hidden="true"/>{number(counts.pending||0)} ürün henüz incelenmedi</span><span>Son aktarım: {data.metrics.latest?date(data.metrics.latest):"Henüz yok"}</span></div>
      </AdminPanel>
      <Link href={href({status:"attention",match:"all",q:"",page:"1"})} className="group flex items-center gap-4 rounded-xl border border-warning/30 bg-warning/5 p-4 transition-colors hover:border-warning/50">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning"><CircleHelp className="size-5" aria-hidden="true"/></span>
        <div className="flex-1"><div className="text-sm font-medium text-warning">Kontrol bekleyen kayıtlar</div><div className="text-2xl font-semibold tabular-nums">{number(attention)}</div><p className="text-xs text-muted-foreground">{number(counts.review||0)} inceleme · {number((counts.blocked||0)+(counts.failed||0))} erişim / işlem hatası</p></div>
        <ArrowUpRight className="size-5 text-warning transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true"/>
      </Link>
    </AdminColumns>

    <AdminPanel title="Katalog turu hızı" actions={<span className="text-xs text-muted-foreground">Son 24 saat</span>}
      footer={<><span className="tabular-nums">{number(data.pass.linked_products)} ürün araç kataloğuna bağlı</span><span className="flex items-center gap-2"><StatusBadge tone={data.pass.blocked?"error":data.pass.challenge_since?"warning":"success"}>{sourceState}</StatusBadge>{data.pass.interval_ms?<span className="tabular-nums">istek aralığı {hours(data.pass.interval_ms/1000)} sn</span>:null}</span></>}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2"><p className="text-sm text-muted-foreground"><strong className="text-xl font-semibold text-foreground tabular-nums">{number(data.pass.finished_24h)}</strong> ürün arandı · çalışırken saatte {number(Math.round(forecast.perActiveHour))}</p><span className="font-semibold text-primary tabular-nums">{days(forecast.daysLeft)}</span></div>
      <p className="text-sm">Tarayıcı son 24 saatin {hours(forecast.activeHours)} saatinde çalıştı (%{Math.round(forecast.uptime*100)}). Kalan {number(counts.pending||0)} ürün bu hızla {days(forecast.daysLeft)}, kesintisiz çalışırsa {days(forecast.daysLeftAlwaysOn)} sürer.</p>
    </AdminPanel>

    {data.pilot&&<AdminPanel title={`${number(data.pilot.sample_size)} ürünlük pilot`} actions={<StatusBadge tone={data.pilot.status==="running"?"info":data.pilot.status==="complete"?"success":data.pilot.status==="blocked"?"error":"neutral"}>{pilotStatuses[data.pilot.status]||data.pilot.status}</StatusBadge>}
      footer={<><span className="tabular-nums">{number(data.pilot.requests)} kaynak isteği · {number(data.pilot.cache_hits)} önbellek kullanımı · {number(data.pilot.rate_limits)} hız sınırı yanıtı</span><span>{data.pilot.last_response?`Son kaynak yanıtı: ${date(data.pilot.last_response)}`:"Tarayıcı bağlantısı bekleniyor"}</span></>}>
      <p className="mb-2 text-sm text-muted-foreground"><strong className="text-xl font-semibold text-foreground tabular-nums">{number(data.pilot.processed)}</strong> / {number(data.pilot.sample_size)} ürün işlendi</p>
      <Progress value={data.pilot.processed/data.pilot.sample_size*100} aria-label="Pilot ürünleri"/>
      <p className="mt-3 text-sm tabular-nums">{number(data.pilot.complete)} tamamlandı · {number(data.pilot.partial)} kısmi · {number(data.pilot.review)} inceleme · {number(data.pilot.not_found)} eşleşmeyen · {number(data.pilot.failed)} hata</p>
    </AdminPanel>}

    <Card className="gap-0 py-0" role="region" aria-labelledby="enrichment-records">
      <CardHeader className="pt-4 pb-1"><CardTitle><h2 id="enrichment-records">Ürün kayıtları</h2></CardTitle><CardDescription>Eşleşmeleri ve veri kapsamını ürün bazında incele.</CardDescription><CardAction><Badge variant="outline" className="tabular-nums">{number(data.total)} kayıt</Badge></CardAction></CardHeader>
      <AdminTabs label="Zenginleştirme durumları" tabs={tabs.map(([key,label,count])=>({href:href({status:key,match:"all",page:"1"}),label,count,current:data.filters.status===key}))}/>
      <form key={`${data.filters.status}:${data.filters.match}:${data.filters.q}`} className="flex flex-wrap items-center gap-2 border-b p-3" method="get">
        <InputGroup className="w-full sm:w-96"><InputGroupAddon><Search aria-hidden="true"/></InputGroupAddon><InputGroupInput name="q" aria-label="Ürün, marka veya OEM ara" defaultValue={data.filters.q} placeholder="Ürün kodu, marka veya OEM ara…"/></InputGroup>
        <NativeSelect aria-label="Kayıt durumu" name="status" defaultValue={data.filters.status}><NativeSelectOption value="enriched">Zenginleştirilen ürünler</NativeSelectOption><NativeSelectOption value="attention">Kontrol bekleyen tüm kayıtlar</NativeSelectOption>{Object.entries(enrichmentStatuses).map(([key,label])=><NativeSelectOption key={key} value={key}>{label}</NativeSelectOption>)}</NativeSelect>
        <NativeSelect aria-label="Eşleşme yöntemi" name="match" defaultValue={data.filters.match}><NativeSelectOption value="all">Tüm eşleşme yöntemleri</NativeSelectOption><NativeSelectOption value="oem_reference">OEM referansıyla</NativeSelectOption><NativeSelectOption value="exact_part">Doğrudan marka / parça</NativeSelectOption></NativeSelect>
        <Button type="submit">Filtrele</Button>
        {(data.filters.q||data.filters.match!=="all")&&<ButtonLink variant="ghost" href={href({q:"",match:"all",page:"1"})}>Temizle</ButtonLink>}
      </form>
      {data.rows.length?<Table className="min-w-[66rem]"><TableHeader><TableRow><TableHead className="pl-4">Ürün / tedarikçi kodu</TableHead><TableHead>Durum</TableHead><TableHead>Eşleşme</TableHead><TableHead>Toplanan veriler</TableHead><TableHead>Son işlem</TableHead><TableHead className="pr-4"><span className="sr-only">Ayrıntılar</span></TableHead></TableRow></TableHeader><TableBody>{data.rows.map(row=><TableRow key={row.id}>
        <TableCell className="pl-4"><div className="flex max-w-80 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-white text-muted-foreground">{row.image_id?<Image src={`/api/product-media/${row.image_id}`} alt="" width={38} height={38} sizes="38px" loading="lazy" className="object-contain"/>:<ImageIcon className="size-4" aria-hidden="true"/>}</div>
          <div className="min-w-0"><Link className="block truncate font-medium hover:text-primary hover:underline" href={`/urun/${row.id}`}>{row.name||row.code}</Link><span className="text-xs text-muted-foreground">{row.brand} · <code className="font-mono">{row.code}</code></span></div>
        </div></TableCell>
        <TableCell><StatusBadge tone={statusTones[row.status]??"neutral"}>{enrichmentStatuses[row.status]||row.status}</StatusBadge></TableCell>
        <TableCell>{row.match_type?<div><span className="flex items-center gap-1.5 text-sm">{row.match_type==="oem_reference"?<GitCompareArrows className="size-3.5 text-muted-foreground" aria-hidden="true"/>:<ShieldCheck className="size-3.5 text-muted-foreground" aria-hidden="true"/>}{row.match_type==="oem_reference"?"OEM referansı":"Doğrudan eşleşme"}</span><code className="block max-w-48 truncate font-mono text-xs text-muted-foreground">{row.reference||`${row.manufacturer} ${row.manufacturer_part_number}`}</code></div>:<span className="text-muted-foreground">Henüz doğrulanmadı</span>}</TableCell>
        <TableCell><div className="flex max-w-56 flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular-nums"><span title="OEM referansı" className="flex items-center gap-1"><Database className="size-3" aria-hidden="true"/><b className="font-semibold text-foreground">{number(row.oem_count)}</b> OEM</span><span title="Araç ve motor satırı" className="flex items-center gap-1"><CarFront className="size-3" aria-hidden="true"/><b className="font-semibold text-foreground">{number(row.vehicle_count)}</b> araç</span><span title="Teknik özellik" className="flex items-center gap-1"><Layers3 className="size-3" aria-hidden="true"/><b className="font-semibold text-foreground">{number(row.specification_count)}</b> özellik</span></div></TableCell>
        <TableCell className="tabular-nums"><time dateTime={(row.imported_at||row.updated_at).toISOString()}>{date(row.imported_at||row.updated_at)}</time><div className="text-xs text-muted-foreground">{row.attempts} deneme</div></TableCell>
        <TableCell className="pr-4 text-right"><EnrichmentDetails name={row.name} code={row.code} productId={row.id} footer={<div className="flex flex-wrap items-center justify-end gap-2 border-t bg-muted/50 px-5 py-3">{row.source_url?<ButtonLink variant="outline" href={row.source_url} target="_blank" className="mr-auto">{new URL(row.source_url).hostname}<ArrowUpRight/></ButtonLink>:<span className="mr-auto text-xs text-muted-foreground">Henüz kaynak verisi kaydedilmedi.</span>}<ButtonLink variant="default" href={`/urun/${row.id}`}>Ürün sayfasını aç<ArrowUpRight/></ButtonLink></div>}>
          <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">{([["Durum",<StatusBadge key="s" tone={statusTones[row.status]??"neutral"}>{enrichmentStatuses[row.status]||row.status}</StatusBadge>],["Eşleşme yöntemi",row.match_type==="oem_reference"?"OEM referansı":row.match_type==="exact_part"?"Doğrudan marka / parça":"Henüz doğrulanmadı"],["Referans ürün",row.manufacturer?`${row.manufacturer} ${row.manufacturer_part_number}`:"Henüz yok"],["Tedarikçi OEM",row.oem||"Belirtilmemiş"],["Görsel",row.image_id?"Kaydedildi":"Henüz yok"],["Son işlem",`${date(row.imported_at||row.updated_at)} · ${row.attempts} deneme`]] as [string,React.ReactNode][]).map(([label,value])=><div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 font-medium break-words">{value}</dd></div>)}</dl>
          <div className="grid grid-cols-3 gap-3 rounded-lg border bg-muted/40 p-3">{([[row.oem_count,"OEM referansı"],[row.vehicle_count,"araç / motor"],[row.specification_count,"teknik özellik"]] as const).map(([value,label])=><div key={label}><b className="block text-xl font-semibold tabular-nums">{number(value)}</b><span className="text-xs text-muted-foreground">{label}</span></div>)}</div>
          {row.last_error&&<StatusMessage tone="warning">Son işlem notu: {row.last_error}</StatusMessage>}
        </EnrichmentDetails></TableCell>
      </TableRow>)}</TableBody></Table>:<EmptyState title="Bu filtrelerle kayıt bulunamadı" icon={<Search/>}>Arama kodunu veya eşleşme yöntemini değiştirerek tekrar dene. <Link className="font-medium text-primary hover:underline" href="/yonetim/urun-verileri">Tüm zenginleştirilen ürünler</Link></EmptyState>}
      <CardFooter className="justify-between border-t py-3 text-sm text-muted-foreground tabular-nums"><span>{data.total?`${number((data.page-1)*data.pageSize+1)}–${number(Math.min(data.page*data.pageSize,data.total))}`:"0"} / {number(data.total)} kayıt</span><div className="flex items-center gap-2"><PagerLink href={data.page>1?href({page:String(data.page-1)}):null}><ChevronLeft/><span className="sr-only">Önceki sayfa</span></PagerLink><span>Sayfa {number(data.page)} / {number(data.pages)}</span><PagerLink href={data.page<data.pages?href({page:String(data.page+1)}):null}><span className="sr-only">Sonraki sayfa</span><ChevronRight/></PagerLink></div></CardFooter>
    </Card>

    <section className="flex flex-col gap-3" aria-labelledby="enrichment-infrastructure">
      <div><h2 id="enrichment-infrastructure" className="text-base font-semibold">Veri kaynağı ve depolama</h2><p className="text-sm text-muted-foreground">Kaynak bağlantısının kontrol sonucu ile kaydedilmiş verileri ayrı takip et.</p></div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex-row items-start gap-3 px-4"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><ArrowDownToLine className="size-4" aria-hidden="true"/></span><div className="flex min-w-0 flex-col gap-2 text-sm">
          <h3 className="font-semibold">Kaynak erişimi</h3>
          {data.sources.map(source=><div key={source.host}><div className="flex flex-wrap items-center gap-2"><strong className="font-medium">{source.host}</strong><StatusBadge tone={source.status==="blocked"?"warning":source.status==="accessible"?"success":"error"}>{source.status==="blocked"?"Doğrudan erişim engelli":source.status==="accessible"?"Erişilebilir":"Bağlantı hatası"}</StatusBadge></div><p className="text-xs text-muted-foreground">HTTP {source.http_status??"—"} · Kontrol: {date(source.checked_at)}</p></div>)}
          {!data.sources.length&&<p className="text-muted-foreground">Henüz kaynak kontrolü yapılmadı.</p>}
          <p className="text-xs text-muted-foreground">Bu sonuç doğrudan HTTP kontrolüne aittir. Tarayıcı üzerinden yapılan aktarımlar yukarıdaki kayıtlarda görünür.</p>
        </div></Card>
        <Card className="flex-row items-start gap-3 px-4"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Database className="size-4" aria-hidden="true"/></span><div className="flex flex-col gap-2 text-sm">
          <h3 className="font-semibold">Veri ve görsel arşivi</h3>
          <p className="flex items-center gap-2 text-muted-foreground"><Check className="size-4 text-success" aria-hidden="true"/>OEM, özellik ve araç bilgileri PostgreSQL’de</p>
          <p className="flex items-center gap-2 text-muted-foreground"><Check className="size-4 text-success" aria-hidden="true"/>Görseller özel MinIO alanında</p>
          <p className="text-xs text-muted-foreground">Tedarikçi marka, kod ve fiyat bilgileri kendi kaynağında korunur.</p>
        </div></Card>
      </div>
    </section>
  </AdminPage>;
}
