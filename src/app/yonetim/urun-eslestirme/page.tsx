import type { ReactNode } from "react";
import Link from "next/link";
import { Boxes, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, GitCompareArrows, Link2, Merge, PackagePlus, Search, SearchX, TriangleAlert, type LucideIcon } from "lucide-react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { SupplierRefreshButton } from "@/components/admin/supplier-refresh-button";
import { DecisionHelp, PairDecision, PairDialog, SetaDialog, StockLabel, type PairRow } from "@/components/admin/product-matching-dialogs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { candidateReasons, productMatchingData, strongSimilarity, type CandidateReason, type Offer } from "@/modules/admin/product-matching";
import { money } from "@/modules/store/catalog";
import { acceptCandidates, decideCandidate, refreshMatches, splitOffers, undoSplit } from "./actions";

const number = (value: number) => new Intl.NumberFormat("tr-TR").format(value);
const date = (value: Date) => new Date(value).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const percent = (value: number | null) => value === null ? null : `%${Math.round(value * 100)}`;
const price = (kurus: number | null | undefined) => kurus ? money(kurus) : "—";
const suppliers: Record<string, string> = { basbug: "Başbuğ", dinamik: "Dinamik", seta: "SETA" };
const messages: Record<string, string> = {
  same: "Aynı marka olarak kaydedildi; ürünler bir sonraki yenilemede birleşir.", equivalent: "Muadil olarak kaydedildi; ortak numaralı ürünler bir sonraki yenilemede birbirine muadil bağlanır.", unrelated: "İlgisiz olarak kaydedildi; bu çift tekrar önerilmez.",
};
const matchedMessages: Record<string, string> = {
  same: "Aynı ürün olarak birleştirildi; mağazada tek ürün olarak, en uygun teklifle satılıyor.", different: "Farklı ürün olarak kaydedildi; bu çift tekrar önerilmez.",
};
const splitMessages: Record<string, string> = {
  "1": "Ayrıldı: Dinamik kaydı artık mağazada ayrı ürün olarak listeleniyor.", undone: "Ayırma kaldırıldı; kayıt ürününe döndü, mağazada bir sonraki yenilemede yeniden birleşir.",
};

function OfferCell({ offer }: { offer: Offer | undefined }) {
  if (!offer) return <span className="text-muted-foreground">—</span>;
  return <div className="flex min-w-0 flex-col gap-1"><span className="max-w-48 truncate font-mono" title={offer.code}>{offer.code}</span>
    <span className="flex items-center gap-2 tabular-nums"><span className="font-medium">{price(offer.price)}</span><StockLabel stock={offer.available}/></span></div>;
}

function ToneBadge({ tone, children }: { tone: "success" | "warning" | "neutral"; children: ReactNode }) {
  const Icon = tone === "success" ? CircleCheck : tone === "warning" ? TriangleAlert : null;
  return <Badge variant={tone === "neutral" ? "outline" : tone}>{Icon && <Icon data-icon="inline-start" aria-hidden="true"/>}{children}</Badge>;
}

function EmptyState({ title, icon, children }: { title: string; icon: ReactNode; children?: ReactNode }) {
  return <Empty><EmptyHeader><EmptyMedia variant="icon">{icon}</EmptyMedia><EmptyTitle>{title}</EmptyTitle>{children && <EmptyDescription>{children}</EmptyDescription>}</EmptyHeader></Empty>;
}

/** URL-driven line tabs; each tab is a link so the view survives reloads and can be shared. */
function LinkTabs({ label, tabs }: { label: string; tabs: { href: string; label: string; count?: number; current: boolean }[] }) {
  const current = tabs.find(tab => tab.current)?.href;
  return <Tabs value={current}><ScrollArea className="pb-2">
    <TabsList variant="line" aria-label={label}>{tabs.map(tab => <TabsTrigger key={tab.href} value={tab.href} nativeButton={false} render={<Link href={tab.href} scroll={false}/>}>
      {tab.label}{tab.count !== undefined && <Badge variant="secondary" className="tabular-nums">{number(tab.count)}</Badge>}
    </TabsTrigger>)}</TabsList>
    <ScrollBar orientation="horizontal"/>
  </ScrollArea></Tabs>;
}

export default async function ProductMatching({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = normalizeSearchParams(await searchParams);
  const data = await productMatchingData(params);
  const stats = data.run?.stats;
  const query = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ tab: params.tab, strength: params.strength, scope: params.scope, q: params.q, ...changes })) if (value) next.set(key, value);
    return `/yonetim/urun-eslestirme${next.size ? `?${next}` : ""}`;
  };
  const tabHref = (tab?: string) => query({ tab, page: undefined, strength: undefined, scope: undefined, q: undefined });
  const back = query({ page: params.page });
  const prev = data.page > 1 ? query({ page: String(data.page - 1) }) : null, next = data.page < data.pages ? query({ page: String(data.page + 1) }) : null;
  const pager = <CardFooter className="flex-wrap justify-between gap-3">
    <span className="text-muted-foreground tabular-nums">{number(data.total)} kayıt · Sayfa {number(data.page)} / {number(data.pages)}</span>
    <Pagination aria-label="Sayfalar" className="mx-0 w-auto"><PaginationContent>
      <PaginationItem>{prev ? <Button variant="ghost" aria-label="Önceki sayfa" nativeButton={false} render={<Link href={prev} scroll={false}/>}><ChevronLeft data-icon="inline-start"/>Önceki</Button> : <Button variant="ghost" disabled><ChevronLeft data-icon="inline-start"/>Önceki</Button>}</PaginationItem>
      <PaginationItem>{next ? <Button variant="ghost" aria-label="Sonraki sayfa" nativeButton={false} render={<Link href={next} scroll={false}/>}>Sonraki<ChevronRight data-icon="inline-end"/></Button> : <Button variant="ghost" disabled>Sonraki<ChevronRight data-icon="inline-end"/></Button>}</PaginationItem>
    </PaginationContent></Pagination>
  </CardFooter>;
  const intro = (text: ReactNode) => <CardDescription>{text}</CardDescription>;
  const search = (tab: string, placeholder: string, extra?: ReactNode) => <form className="flex flex-wrap items-center gap-2" action="/yonetim/urun-eslestirme">
    <input type="hidden" name="tab" value={tab}/>{params.scope && <input type="hidden" name="scope" value={params.scope}/>}
    <InputGroup className="w-full sm:w-64"><InputGroupAddon><Search aria-hidden="true"/></InputGroupAddon><InputGroupInput name="q" aria-label="Ara" defaultValue={params.q} placeholder={placeholder} maxLength={80}/></InputGroup>
    <Button type="submit">Ara</Button>{params.q && <Button variant="ghost" nativeButton={false} render={<Link href={query({ q: undefined, page: undefined })}/>}>Temizle</Button>}{extra}
  </form>;
  const pending = data.strength.strong + data.strength.weak;

  let body: ReactNode = null;
  if ("pairs" in data) {
    const pairs: PairRow[] = data.pairs.map(pair => ({ brand_a: pair.brand_a, brand_b: pair.brand_b, shared_parts: number(pair.shared_parts),
      shared_eans: pair.shared_eans ? number(pair.shared_eans) : null, similarity: percent(pair.avg_name_similarity),
      strong: (pair.avg_name_similarity ?? 0) >= strongSimilarity, samples: pair.samples, ean_samples: pair.ean_samples }));
    body = <>
      <CardContent className="flex flex-col gap-4">
        {intro("Aynı parça numarası farklı tedarikçilerde farklı marka adıyla geçiyor. Aynı markaysa ürünler birleşir; karar tüm ortak parçalara uygulanır ve yenilemeden sonra geçerli olur.")}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <LinkTabs label="Benzerlik" tabs={[
            { href: query({ strength: undefined, page: undefined }), label: "Güçlü benzerlik", count: data.strength.strong, current: !data.weak },
            { href: query({ strength: "weak", page: undefined }), label: "Zayıf benzerlik", count: data.strength.weak, current: data.weak },
          ]}/>
          <DecisionHelp/>
        </div>
        {pairs.length ? <Table><caption className="sr-only">İncelenecek marka çiftleri</caption>
          <TableHeader><TableRow><TableHead>Marka A</TableHead><TableHead>Marka B</TableHead><TableHead className="text-right">Ortak no</TableHead><TableHead className="text-right" title="Dinamik'te ortak barkod">Ortak barkod</TableHead><TableHead className="text-center" title="Ürün adı benzerliği">Benzerlik</TableHead><TableHead>Örnek (parça no · A · B)</TableHead><TableHead>Karar</TableHead><TableHead><span className="sr-only">Örnekler</span></TableHead></TableRow></TableHeader>
          <TableBody>{pairs.map(pair => {
            // Barcode-only pairs share no part number; their first barcode match stands in as the example.
            const ean = pair.ean_samples[0];
            const sample = pair.samples[0] ?? (ean && { part: ean.ean, a: `${ean.part_a} ${ean.a ?? ""}`.trim(), b: `${ean.part_b} ${ean.b ?? ""}`.trim() });
            const sampleText = sample ? `${sample.part} · ${sample.a || "—"} · ${sample.b || "—"}` : "—";
            return <TableRow key={`${pair.brand_a}|${pair.brand_b}`}>
              <TableCell className="max-w-32 truncate font-medium" title={pair.brand_a}>{pair.brand_a}</TableCell>
              <TableCell className="max-w-32 truncate font-medium" title={pair.brand_b}>{pair.brand_b}</TableCell>
              <TableCell className="text-right tabular-nums">{pair.shared_parts}</TableCell>
              <TableCell className="text-right tabular-nums">{pair.shared_eans ?? <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell className="text-center">{pair.similarity ? <ToneBadge tone={pair.strong ? "success" : "warning"}>{pair.similarity}</ToneBadge> : "—"}</TableCell>
              <TableCell className="max-w-72 truncate text-muted-foreground" title={sampleText}>{sample ? <><span className="font-mono text-foreground">{sample.part}</span> · {sample.a || "—"} · {sample.b || "—"}</> : "—"}</TableCell>
              <TableCell><PairDecision pair={pair} back={back}/></TableCell>
              <TableCell><PairDialog pair={pair} back={back}/></TableCell>
            </TableRow>;
          })}</TableBody></Table> : <EmptyState title="Bu görünümde incelenecek marka çifti yok." icon={<GitCompareArrows/>}/>}
      </CardContent>
      {pager}
    </>;
  } else if ("candidates" in data) {
    const reasons = Object.keys(candidateReasons) as CandidateReason[];
    const bulkBrand = data.brandFilter && data.reason && data.candidates.length > 0 && data.candidates.every(item => item.brand === data.brandFilter) ? data.brandFilter : null;
    const side = (item: { id: string; brand_label: string; code: string; name: string | null; price_kurus: number | null; available: boolean | null }) =>
      <div className="flex min-w-0 flex-col gap-1">
        <Link className="max-w-56 truncate font-mono underline-offset-4 hover:underline" href={`/yonetim/urunler/${item.id}`} title={item.code}>{item.code}</Link>
        <span className="max-w-64 truncate text-muted-foreground" title={item.name ?? ""}>{item.name || "—"}</span>
        <span className="flex items-center gap-2 tabular-nums"><span className="font-medium">{price(item.price_kurus)}</span><StockLabel stock={item.available}/></span>
      </div>;
    body = <>
      <CardContent className="flex flex-col gap-4">
        {intro("Otomatik eşleşmenin kaçırdığı, aynı markada parça numarası küçük farkla yazılmış Başbuğ ve Dinamik ürünleri. “Aynı ürün” derseniz Dinamik kaydı Başbuğ ürününe bağlanır ve mağazada tek ürün olur; karar kalıcıdır, ürün sayfasından geri alınabilir.")}
        <LinkTabs label="Öneri nedeni" tabs={[
          { href: query({ scope: undefined, page: undefined }), label: "Tümü", count: Object.values(data.byReason).reduce((sum, count) => sum + (count ?? 0), 0), current: !data.reason },
          ...reasons.map(reason => ({ href: query({ scope: reason, page: undefined }), label: candidateReasons[reason], count: data.byReason[reason] ?? 0, current: data.reason === reason })),
        ]}/>
        <div className="flex flex-wrap items-center gap-2">
          {search("candidates", "Marka (ör. CONTITECH) veya parça no")}
          {bulkBrand && data.reason && <form action={acceptCandidates}>
            <input type="hidden" name="reason" value={data.reason}/><input type="hidden" name="brand" value={bulkBrand}/><input type="hidden" name="back" value={back}/>
            <Button type="submit" variant="outline"><CircleCheck data-icon="inline-start" aria-hidden="true"/>{bulkBrand} için tümünü aynı say ({number(data.total)})</Button>
          </form>}
        </div>
        {!bulkBrand && <p className="text-muted-foreground">İpucu: bir neden seçip marka adıyla arayın (ör. CONTITECH); o markanın tüm önerilerini tek seferde kabul edebilirsiniz.</p>}
        {data.candidates.length ? <Table><caption className="sr-only">Olası aynı ürünler</caption>
          <TableHeader><TableRow><TableHead>Neden</TableHead><TableHead>Başbuğ</TableHead><TableHead>Dinamik</TableHead><TableHead className="text-center" title="Ürün adı benzerliği">Benzerlik</TableHead><TableHead>Karar</TableHead></TableRow></TableHeader>
          <TableBody>{data.candidates.map(item => <TableRow key={`${item.a.id}|${item.b.id}`} className="align-top">
            <TableCell className="flex flex-col gap-1"><span>{candidateReasons[item.reason]}</span><span className="text-muted-foreground">{item.a.brand_label}</span></TableCell>
            <TableCell>{side(item.a)}</TableCell>
            <TableCell>{side(item.b)}</TableCell>
            <TableCell className="text-center">{item.name_similarity === null ? "—" : <ToneBadge tone={item.name_similarity >= 0.3 ? "success" : item.name_similarity >= 0.15 ? "neutral" : "warning"}>{percent(item.name_similarity)}</ToneBadge>}</TableCell>
            <TableCell><div className="flex flex-wrap gap-2">{(["same", "different"] as const).map(status => <form key={status} action={decideCandidate}>
              <input type="hidden" name="product_a" value={item.a.id}/><input type="hidden" name="product_b" value={item.b.id}/>
              <input type="hidden" name="status" value={status}/><input type="hidden" name="back" value={back}/>
              <Button type="submit" variant={status === "same" ? "default" : "ghost"}>{status === "same" ? "Aynı ürün" : "Farklı"}</Button>
            </form>)}</div></TableCell>
          </TableRow>)}</TableBody></Table> : <EmptyState title="İncelenecek öneri yok." icon={<GitCompareArrows/>}/>}
      </CardContent>
      {pager}
    </>;
  } else if ("same" in data) {
    const summary = "summary" in data ? data.summary : undefined, split = "split" in data ? data.split : undefined;
    body = <>
      <CardContent className="flex flex-col gap-4">
        {intro("Başbuğ ürününün aynısı Dinamik'te de var. Mağazada tek ürün görünür; fiyat ve stok, stokta olan en ucuz tekliften gelir. Eşleşme yanlışsa “Ayır” deyin: Dinamik kaydı ayrı ürün olur.")}
        <LinkTabs label="Satıştaki teklif" tabs={[
          { href: query({ scope: undefined, page: undefined }), label: "Tümü", count: summary?.all, current: data.scope === "all" },
          { href: query({ scope: "dinamik", page: undefined }), label: "Dinamik satışta", count: summary?.dinamik, current: data.scope === "dinamik" },
          { href: query({ scope: "basbug", page: undefined }), label: "Başbuğ satışta", count: summary?.basbug, current: data.scope === "basbug" },
          { href: query({ scope: "none", page: undefined }), label: "Stok yok", count: summary?.none, current: data.scope === "none" },
          { href: query({ scope: "split", page: undefined, q: undefined }), label: "Elle kararlar", count: data.exclusions, current: data.scope === "split" },
        ]}/>
        {split ? (split.length ? <Table><caption className="sr-only">Ayrılan kayıtlar</caption>
          <TableHeader><TableRow><TableHead>Tedarikçi</TableHead><TableHead>Kod</TableHead><TableHead>Ad</TableHead><TableHead>Karar</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader>
          <TableBody>{split.map(item => <TableRow key={item.id}>
            <TableCell>{suppliers[item.supplier] ?? item.supplier}</TableCell>
            <TableCell className="max-w-44 truncate font-mono" title={item.code}>{item.code}</TableCell>
            <TableCell className="max-w-80 truncate" title={item.name ?? ""}>{item.name || "—"}</TableCell>
            <TableCell className="text-muted-foreground">{date(item.decided_at)}</TableCell>
            <TableCell><form action={undoSplit}><input type="hidden" name="item_id" value={item.id}/><input type="hidden" name="back" value={back}/><Button type="submit" variant="outline">Geri al</Button></form></TableCell>
          </TableRow>)}</TableBody></Table> : <EmptyState title="Elle karar verilmiş kayıt yok." icon={<Boxes/>}/>) : <>
          {search("same", "Parça no veya kod")}
          {"same" in data && data.same.length ? <Table><caption className="sr-only">{"Başbuğ ve Dinamik'te aynı ürünler"}</caption>
            <TableHeader><TableRow><TableHead>Ürün</TableHead><TableHead>Başbuğ</TableHead><TableHead>Dinamik</TableHead><TableHead>Mağazada satılan</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader>
            <TableBody>{data.same.map(group => {
              const primary = group.offers[0], dinamik = group.offers.filter(offer => offer.supplier === "dinamik");
              const saving = group.selling === "dinamik" && group.primary_price && group.selling_price ? Math.round((1 - group.selling_price / group.primary_price) * 100) : 0;
              return <TableRow key={group.primary_id} className="align-top">
                <TableCell className="max-w-80 whitespace-normal"><Button variant="link" className="h-auto p-0 text-left whitespace-normal" nativeButton={false} render={<a href={`/urun/${group.primary_id}`} target="_blank" rel="noreferrer" title={primary.name}/>}>{primary.name}</Button></TableCell>
                <TableCell><OfferCell offer={primary}/></TableCell>
                <TableCell><OfferCell offer={dinamik[0]}/>{dinamik.length > 1 && <div className="text-muted-foreground">+{dinamik.length - 1} kayıt</div>}</TableCell>
                <TableCell>{group.selling ? <div className="flex flex-col items-start gap-1"><ToneBadge tone={group.selling === "dinamik" ? "success" : "neutral"}>{suppliers[group.selling]}</ToneBadge>
                  <span className="tabular-nums">{price(group.selling_price)}{saving > 0 && <span className="text-muted-foreground"> · %{saving} ucuz</span>}</span></div> : <span className="text-muted-foreground">Stok yok</span>}</TableCell>
                <TableCell><form action={splitOffers}><input type="hidden" name="primary_id" value={group.primary_id}/><input type="hidden" name="back" value={back}/>
                  <Button type="submit" variant="ghost" title="Yanlış eşleşme: Dinamik kaydı ayrı ürün olsun">Ayır</Button></form></TableCell>
              </TableRow>;
            })}</TableBody></Table> : <EmptyState title="Bu görünümde ürün yok." icon={<SearchX/>}/>}
        </>}
      </CardContent>
      {!split && pager}
    </>;
  } else if ("dinamik" in data) {
    body = <>
      <CardContent className="flex flex-col gap-4">
        {intro("Başbuğ'da karşılığı bulunmayan Dinamik ürünleri. Mağazada ayrı ürün olarak listelenir; görsel, özellik ve araç bilgisi Trodo zenginleştirmesiyle gelir. Başbuğ'da aynısı varsa “Eşleştir” ile ürün sayfasından birleştirin.")}
        {search("dinamik", "Kod veya OEM")}
        {data.dinamik.length ? <Table><caption className="sr-only">{"Yalnız Dinamik'te olan ürünler"}</caption>
          <TableHeader><TableRow><TableHead>Kod</TableHead><TableHead>Marka</TableHead><TableHead>Ad</TableHead><TableHead className="text-right">Fiyat</TableHead><TableHead className="text-center">Stok</TableHead><TableHead>Trodo</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader>
          <TableBody>{data.dinamik.map(item => <TableRow key={item.id}>
            <TableCell className="max-w-44 truncate font-mono" title={item.code}><Button variant="link" className="h-auto p-0 font-mono" nativeButton={false} render={<a href={`/urun/${item.id}`} target="_blank" rel="noreferrer"/>}>{item.code}</Button></TableCell>
            <TableCell className="max-w-28 truncate text-muted-foreground" title={item.brand ?? ""}>{item.brand || "—"}</TableCell>
            <TableCell className="max-w-80 truncate" title={item.name ?? ""}>{item.name || "—"}</TableCell>
            <TableCell className="text-right font-medium tabular-nums">{price(item.price_kurus)}</TableCell>
            <TableCell className="text-center"><StockLabel stock={item.available}/></TableCell>
            <TableCell><ToneBadge tone={item.enriched ? "success" : "neutral"}>{item.enriched ? "Zenginleştirildi" : "Bekliyor"}</ToneBadge></TableCell>
            <TableCell>{item.product_id && <Button variant="ghost" nativeButton={false} render={<Link href={`/yonetim/urunler/${item.product_id}#birlestir`}/>}>Eşleştir</Button>}</TableCell>
          </TableRow>)}</TableBody></Table> : <EmptyState title="Ürün bulunamadı." icon={<SearchX/>}/>}
      </CardContent>
      {pager}
    </>;
  } else if ("seta" in data) {
    body = <>
      <CardContent className="flex flex-col gap-4">
        {intro("SETA kendi markasıdır; aynı ürün değil muadil olarak gösterilir. Ortak OEM numarası veya SETA'nın rakip kodu üzerinden Başbuğ/Dinamik ürün sayfasında “OEM ve muadil numaraları” bölümünde yer alır.")}
        <LinkTabs label="Bağlantı" tabs={[
          { href: query({ scope: undefined, page: undefined }), label: "Bağlı", count: stats?.seta_linked_items, current: data.scope === "linked" },
          { href: query({ scope: "unlinked", page: undefined }), label: "Bağlantısız", current: data.scope === "unlinked" },
        ]}/>
        {search("seta", "SETA kodu veya OEM")}
        {data.seta.length ? <Table><caption className="sr-only">SETA muadilleri</caption>
          <TableHeader><TableRow><TableHead>SETA kodu</TableHead><TableHead>Ad</TableHead><TableHead className="text-right">Fiyat</TableHead><TableHead className="text-center">Stok</TableHead><TableHead className="text-right">Gösterildiği ürün</TableHead><TableHead>Örnek</TableHead><TableHead><span className="sr-only">Bağlantılar</span></TableHead></TableRow></TableHeader>
          <TableBody>{data.seta.map(item => <TableRow key={item.id}>
            <TableCell className="max-w-36 truncate font-mono" title={item.code}><Button variant="link" className="h-auto p-0 font-mono" nativeButton={false} render={<a href={`/urun/${item.id}`} target="_blank" rel="noreferrer"/>}>{item.code}</Button></TableCell>
            <TableCell className="max-w-80 truncate" title={item.name ?? ""}>{item.name || "—"}</TableCell>
            <TableCell className="text-right font-medium tabular-nums">{price(item.price_kurus)}</TableCell>
            <TableCell className="text-center"><StockLabel stock={item.available}/></TableCell>
            <TableCell className="text-right tabular-nums">{number(item.linked)}</TableCell>
            <TableCell className="max-w-56 truncate text-muted-foreground" title={item.products.map(product => product.code).join(", ")}>{item.products.slice(0, 2).map(product => product.code).join(", ") || "—"}</TableCell>
            <TableCell>{item.products.length > 0 && <SetaDialog title={`SETA ${item.code}`} description={`${number(item.linked)} ürün sayfasında muadil olarak gösteriliyor`}
              products={item.products.map(product => ({ ...product, supplier: suppliers[product.supplier] ?? product.supplier }))}/>}</TableCell>
          </TableRow>)}</TableBody></Table> : <EmptyState title="SETA ürünü bulunamadı." icon={<SearchX/>}/>}
      </CardContent>
      {pager}
    </>;
  }

  const notice = (text: ReactNode) => <Alert variant="success" role="status"><CircleCheck/><AlertDescription>{text}</AlertDescription></Alert>;
  const statCards: { icon: LucideIcon; label: string; value: number; note: string; href: string; badge?: ReactNode }[] = stats ? [
    { icon: GitCompareArrows, label: "1 · Marka kararı bekleyen", value: pending, note: `${number(data.strength.strong)} güçlü · ${number(data.strength.weak)} zayıf benzerlik`, href: tabHref(),
      badge: <ToneBadge tone={data.strength.strong ? "warning" : "success"}>{data.strength.strong ? "İnceleme var" : "Güncel"}</ToneBadge> },
    { icon: Merge, label: "2 · Olası aynı ürün", value: data.pendingCandidates, note: "Küçük kod farkı; aynı ürün mü, siz karar verin", href: tabHref("candidates"),
      badge: <ToneBadge tone={data.pendingCandidates ? "warning" : "success"}>{data.pendingCandidates ? "İnceleme var" : "Güncel"}</ToneBadge> },
    { icon: Boxes, label: "3 · Başbuğ + Dinamik aynı ürün", value: stats.basbug_dinamik_groups ?? 0, note: `Tek ürün, en uygun teklif · ${date(data.run!.completed_at)}`, href: tabHref("same") },
    { icon: PackagePlus, label: "4 · Yalnız Dinamik'te", value: stats.dinamik_only ?? 0, note: "Ayrı ürün olarak listelenir", href: tabHref("dinamik") },
    { icon: Link2, label: "5 · SETA muadili", value: stats.seta_linked_items ?? 0, note: `${number(stats.seta_linked_products ?? 0)} Başbuğ/Dinamik kaydında gösteriliyor`, href: tabHref("seta") },
  ] : [];

  return <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <Breadcrumb><BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink render={<Link href="/yonetim"/>}>Yönetim</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator/>
        <BreadcrumbItem><BreadcrumbPage>Ürün eşleştirme</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList></Breadcrumb>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-3xl flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Ürün eşleştirme</h1>
          <p className="text-muted-foreground">Başbuğ ana katalogdur. Aynı ürün Dinamik&apos;te de varsa mağazada tek ürün olarak, stokta olan en ucuz fiyatla satılır. Dinamik&apos;e özgü ürünler ayrı listelenir; SETA ürünleri muadil olarak gösterilir.</p>
        </div>
        <form action={refreshMatches}><SupplierRefreshButton label="Eşleştirmeyi yenile" pendingLabel="Eşleştiriliyor (~1 dk)…"/></form>
      </div>
    </div>
    {params.refreshed === "1" && notice("Eşleştirme yenilendi.")}
    {params.decided && messages[params.decided] && notice(messages[params.decided])}
    {params.split && splitMessages[params.split] && notice(splitMessages[params.split])}
    {params.matched && (params.matched === "bulk" ? notice(`${number(Number(params.count) || 0)} öneri aynı ürün olarak birleştirildi.`) : matchedMessages[params.matched] && notice(matchedMessages[params.matched]))}
    {params.error && <Alert variant="destructive" role="alert"><CircleAlert/><AlertDescription>{params.error === "refresh" ? "Eşleştirme tamamlanamadı; önceki sonuçlar korunuyor." : "İşlem kaydedilemedi."}</AlertDescription></Alert>}
    {!stats ? <EmptyState title="Eşleştirme henüz çalıştırılmadı." icon={<Boxes/>}>Sağ üstteki düğmeyle veya <code>npm run products:match</code> ile başlatın.</EmptyState> : <>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5" aria-label="Eşleştirme özeti">{statCards.map(card => <Card key={card.label}>
        <CardHeader><dt><CardDescription className="flex items-center gap-2"><card.icon className="size-4" aria-hidden="true"/>{card.label}</CardDescription></dt>
          <dd><CardTitle className="text-2xl font-semibold tabular-nums">{number(card.value)}</CardTitle></dd>{card.badge && <CardAction>{card.badge}</CardAction>}</CardHeader>
        <CardFooter className="flex-col items-start gap-1 text-sm"><span className="text-muted-foreground">{card.note}</span>
          <Button variant="link" className="h-auto p-0" nativeButton={false} render={<Link href={card.href}/>}>İncele<ChevronRight data-icon="inline-end" aria-hidden="true"/></Button></CardFooter>
      </Card>)}</dl>
      <Card>
        <CardHeader>
          <LinkTabs label="Eşleştirme adımları" tabs={[
            { href: tabHref(), label: "1 · Marka eşleştirme", count: pending, current: data.tab === "pairs" },
            { href: tabHref("candidates"), label: "2 · Olası aynı ürünler", count: data.pendingCandidates, current: data.tab === "candidates" },
            { href: tabHref("same"), label: "3 · Aynı ürünler", count: stats.basbug_dinamik_groups, current: data.tab === "same" },
            { href: tabHref("dinamik"), label: "4 · Yalnız Dinamik", count: stats.dinamik_only, current: data.tab === "dinamik" },
            { href: tabHref("seta"), label: "5 · SETA muadilleri", count: stats.seta_linked_items, current: data.tab === "seta" },
          ]}/>
        </CardHeader>
        <Separator/>
        {body}
      </Card>
    </>}
  </div>;
}
