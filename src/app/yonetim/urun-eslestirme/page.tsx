import type { ReactNode } from "react";
import Link from "next/link";
import { Boxes, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, GitCompareArrows, Link2, Merge, PackagePlus, SearchX, Tags, TriangleAlert, type LucideIcon } from "lucide-react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { SupplierRefreshButton } from "@/components/admin/supplier-refresh-button";
import { BrandLabelList } from "@/components/admin/brand-label-list";
import { BrandDialog, ConfirmBrand, PairDecision, PairDialog, SetaDialog, StockLabel, type BrandRow, type PairRow } from "@/components/admin/product-matching-dialogs";
import { ProductMatchingFilters, type MatchingFilter } from "@/components/admin/product-matching-filters";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { candidateNames, candidateReasons, productMatchingData, strongSimilarity, type CandidateNames, type CandidateReason, type Offer } from "@/modules/admin/product-matching";
import { money } from "@/modules/store/catalog";
import { acceptCandidates, decideCandidate, rejectCandidates, refreshMatches, splitOffers, undoSplit } from "./actions";

const number = (value: number) => new Intl.NumberFormat("tr-TR").format(value);
const date = (value: Date) => new Date(value).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const percent = (value: number | null) => value === null ? null : `%${Math.round(value * 100)}`;
const price = (kurus: number | null | undefined) => kurus ? money(kurus) : "—";
const suppliers: Record<string, string> = { basbug: "Başbuğ", dinamik: "Dinamik", seta: "SETA" };
const brandMessages: Record<string, string> = {
  confirmed: "Ana marka onaylandı.", renamed: "Ana marka adı güncellendi.", moved: "Etiket taşındı; ürünler bir sonraki yenilemede yeni ana markaya göre gruplanır.",
  created: "Etiket ayrı ana marka oldu; ürünler bir sonraki yenilemede ayrılır.", merged: "Ana markalar birleşti; ürünler bir sonraki yenilemede birleşir.",
};
const brandSuppliers = ["basbug", "dinamik", "seta"] as const;
const messages: Record<string, string> = {
  same: "Aynı marka olarak kaydedildi; ana markalar birleşti, ürünler bir sonraki yenilemede birleşir.", equivalent: "Muadil olarak kaydedildi; ortak numaralı ürünler bir sonraki yenilemede birbirine muadil bağlanır.", unrelated: "İlgisiz olarak kaydedildi; bu çift tekrar önerilmez.",
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

function EmptyState({ title, icon }: { title: string; icon: ReactNode }) {
  return <Empty><EmptyHeader><EmptyMedia variant="icon">{icon}</EmptyMedia><EmptyTitle>{title}</EmptyTitle></EmptyHeader></Empty>;
}

/** URL-driven line tabs; each tab is a link so the view survives reloads and can be shared. */
function LinkTabs({ label, tabs }: { label: string; tabs: { href: string; label: string; count?: number; current: boolean }[] }) {
  const current = tabs.find(tab => tab.current)?.href;
  return <Tabs value={current} className="min-w-0"><ScrollArea className="pb-2">
    <TabsList variant="line" activateOnFocus={false} aria-label={label}>{tabs.map(tab => <TabsTrigger key={tab.href} value={tab.href} nativeButton={false} render={<Link href={tab.href} scroll={false}/>}>
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
    for (const [key, value] of Object.entries({ tab: params.tab, strength: params.strength, scope: params.scope, names: params.names, q: params.q, sort: params.sort, dir: params.dir, ...changes })) if (value) next.set(key, value);
    return `/yonetim/urun-eslestirme${next.size ? `?${next}` : ""}`;
  };
  const tabHref = (tab?: string) => query({ tab, page: undefined, strength: undefined, scope: undefined, names: undefined, q: undefined, sort: undefined, dir: undefined });
  const back = query({ page: params.page });
  const prev = data.page > 1 ? query({ page: String(data.page - 1) }) : null, next = data.page < data.pages ? query({ page: String(data.page + 1) }) : null;
  const pager = data.total > 0 && <CardFooter className="flex-wrap justify-between gap-3">
    <span className="text-muted-foreground tabular-nums">{number(data.total)} kayıt</span>
    <Pagination aria-label="Sayfalar" className="mx-0 w-auto"><PaginationContent>
      <PaginationItem>{prev ? <Button variant="outline" size="icon" aria-label="Önceki sayfa" nativeButton={false} render={<Link href={prev} scroll={false}/>}><ChevronLeft/></Button> : <Button variant="outline" size="icon" aria-label="Önceki sayfa" disabled><ChevronLeft/></Button>}</PaginationItem>
      <PaginationItem><span className="px-2 text-muted-foreground tabular-nums" aria-label={`Sayfa ${data.page} / ${data.pages}`}>{number(data.page)} / {number(data.pages)}</span></PaginationItem>
      <PaginationItem>{next ? <Button variant="outline" size="icon" aria-label="Sonraki sayfa" nativeButton={false} render={<Link href={next} scroll={false}/>}><ChevronRight/></Button> : <Button variant="outline" size="icon" aria-label="Sonraki sayfa" disabled><ChevronRight/></Button>}</PaginationItem>
    </PaginationContent></Pagination>
  </CardFooter>;
  const search = (tab: string, placeholder: string, filters?: MatchingFilter[]) => <ProductMatchingFilters
    key={`${tab}|${params.q}|${params.scope}|${params.names}|${params.sort}|${params.dir}`}
    params={{ tab, q: params.q, scope: params.scope, names: params.names, sort: params.sort, dir: params.dir }}
    placeholder={placeholder} filters={filters} resetHref={query({ q: undefined, scope: undefined, names: undefined, page: undefined })}/>;
  const brandTabs = <LinkTabs label="Markalar" tabs={[
    { href: query({ scope: undefined, strength: undefined, page: undefined }), label: "Onay bekleyen", count: data.brandCount.pending, current: "scope" in data && data.scope === "pending" },
    { href: query({ scope: "single", strength: undefined, page: undefined }), label: "Tek tedarikçide", count: data.brandCount.single, current: "scope" in data && data.scope === "single" },
    { href: query({ scope: "all", strength: undefined, page: undefined }), label: "Tüm ana markalar", count: data.brandCount.all, current: "scope" in data && data.scope === "all" },
    { href: query({ scope: "suggestions", strength: undefined, page: undefined, q: undefined }), label: "Benzer marka önerileri", count: data.brandCount.suggestions, current: "scope" in data && data.scope === "suggestions" },
  ]}/>;

  let body: ReactNode = null;
  if ("brands" in data) {
    const rows: BrandRow[] = data.brands.map(brand => ({ id: brand.id, key: brand.key, name: brand.name, items: number(brand.items), pending: brand.pending,
      labels: brand.labels.map(label => ({ ...label, supplierName: suppliers[label.supplier] ?? label.supplier, items: number(label.items) })) }));
    body = <>
      <CardContent className="flex flex-col gap-4">
        {search("brands", "Marka veya etiket", [{ name: "scope", label: "Marka durumu", value: data.scope === "pending" ? "" : data.scope, options: [
          { value: "", label: `Bekleyen (${number(data.brandCount.pending)})` },
          { value: "single", label: `Tek tedarikçi (${number(data.brandCount.single)})` },
          { value: "all", label: `Tüm markalar (${number(data.brandCount.all)})` },
          { value: "suggestions", label: `Benzer markalar (${number(data.brandCount.suggestions)})` },
        ] }])}
        <datalist id="brand-names">{data.names.map(name => <option key={name} value={name}/>)}</datalist>
        {rows.length ? <Table server><caption className="sr-only">Ana markalar ve tedarikçi etiketleri</caption>
          <TableHeader><TableRow><TableHead sortKey="name">Ana marka</TableHead>{brandSuppliers.map(supplier => <TableHead key={supplier}>{suppliers[supplier]}</TableHead>)}<TableHead sortKey="items" className="text-right">Kayıt</TableHead><TableHead>Durum</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader>
          <TableBody>{rows.map(brand => <TableRow key={brand.id}>
            <TableCell className="max-w-48 truncate font-medium" title={brand.name}>{brand.name}</TableCell>
            {brandSuppliers.map(supplier => {
              return <TableCell key={supplier}><BrandLabelList brand={brand.name} supplier={suppliers[supplier]} labels={brand.labels.filter(label => label.supplier === supplier)}/></TableCell>;
            })}
            <TableCell className="text-right tabular-nums">{brand.items}</TableCell>
            <TableCell>{brand.pending ? <ToneBadge tone="warning">Otomatik</ToneBadge> : <ToneBadge tone="success">Onaylı</ToneBadge>}</TableCell>
            <TableCell><div className="flex items-center gap-1">{brand.pending && <ConfirmBrand id={brand.id} back={back}/>}<BrandDialog key={`${brand.name}|${brand.labels.map(label => `${label.supplier}:${label.label}:${label.method}`).join(",")}`} brand={brand} back={back}/></div></TableCell>
          </TableRow>)}</TableBody></Table> : <EmptyState title="Bu görünümde ana marka yok." icon={<Tags/>}/>}
      </CardContent>
      {pager}
    </>;
  } else if ("pairs" in data) {
    const pairs: PairRow[] = data.pairs.map(pair => ({ brand_a: pair.brand_a, brand_b: pair.brand_b, name_a: pair.name_a, name_b: pair.name_b, shared_parts: number(pair.shared_parts),
      shared_eans: pair.shared_eans ? number(pair.shared_eans) : null, similarity: percent(pair.avg_name_similarity),
      strong: (pair.avg_name_similarity ?? 0) >= strongSimilarity, samples: pair.samples, ean_samples: pair.ean_samples }));
    body = <>
      <CardContent className="flex flex-col gap-4">
        {brandTabs}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <LinkTabs label="Benzerlik" tabs={[
            { href: query({ strength: undefined, page: undefined }), label: "Güçlü benzerlik", count: data.strength.strong, current: !data.weak },
            { href: query({ strength: "weak", page: undefined }), label: "Zayıf benzerlik", count: data.strength.weak, current: data.weak },
          ]}/>
        </div>
        {pairs.length ? <Table server><caption className="sr-only">İncelenecek marka çiftleri</caption>
          <TableHeader><TableRow><TableHead sortKey="brand_a">Ana marka A</TableHead><TableHead sortKey="brand_b">Ana marka B</TableHead><TableHead sortKey="shared" className="text-right">Ortak no</TableHead><TableHead sortKey="eans" className="text-right" title="Dinamik'te ortak barkod">Ortak barkod</TableHead><TableHead sortKey="similarity" className="text-center" title="Ürün adı benzerliği">Benzerlik</TableHead><TableHead>Örnek (parça no · A · B)</TableHead><TableHead>Karar</TableHead><TableHead><span className="sr-only">Örnekler</span></TableHead></TableRow></TableHeader>
          <TableBody>{pairs.map(pair => {
            // Barcode-only pairs share no part number; their first barcode match stands in as the example.
            const ean = pair.ean_samples[0];
            const sample = pair.samples[0] ?? (ean && { part: ean.ean, a: `${ean.part_a} ${ean.a ?? ""}`.trim(), b: `${ean.part_b} ${ean.b ?? ""}`.trim() });
            const sampleText = sample ? `${sample.part} · ${sample.a || "—"} · ${sample.b || "—"}` : "—";
            return <TableRow key={`${pair.brand_a}|${pair.brand_b}`}>
              <TableCell className="max-w-32 truncate font-medium" title={pair.name_a}>{pair.name_a}</TableCell>
              <TableCell className="max-w-32 truncate font-medium" title={pair.name_b}>{pair.name_b}</TableCell>
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
    const reasons = Object.keys(candidateReasons) as CandidateReason[], nameKinds = Object.keys(candidateNames) as CandidateNames[];
    const bulkBrand = data.brandFilter && data.reason && data.candidates.length > 0 && data.candidates.every(item => item.brand === data.brandFilter) ? data.brandFilter : null;
    const side = (item: { id: string; brand_label: string; code: string; name: string | null; price_kurus: number | null; available: boolean | null }) =>
      <div className="flex min-w-0 flex-col gap-1">
        <Link className="max-w-56 truncate font-mono underline-offset-4 hover:underline" href={`/yonetim/urunler/${item.id}`} title={item.code}>{item.code}</Link>
        <span className="max-w-64 truncate text-muted-foreground" title={item.name ?? ""}>{item.name || "—"}</span>
        <span className="flex items-center gap-2 tabular-nums"><span className="font-medium">{price(item.price_kurus)}</span><StockLabel stock={item.available}/></span>
      </div>;
    body = <>
      <CardContent className="flex flex-col gap-4">
        {search("candidates", "Marka veya parça no", [
          { name: "scope", label: "Öneri nedeni", value: data.reason ?? "", options: [
            { value: "", label: "Tüm nedenler" },
            ...reasons.map(reason => ({ value: reason, label: `${candidateReasons[reason]} (${number(data.byReason[reason] ?? 0)})` })),
          ] },
          { name: "names", label: "Parça tanımı", value: data.names ?? "", options: [
            { value: "", label: "Tüm tanımlar" },
            ...nameKinds.map(kind => ({ value: kind, label: `${candidateNames[kind]} (${number(data.byNames[kind])})` })),
          ] },
        ])}
        {(bulkBrand || data.names === "conflict") && <div className="flex flex-wrap items-center gap-2">
          {bulkBrand && data.reason && data.names !== "conflict" && data.acceptableTotal > 0 && <form action={acceptCandidates}>
            <input type="hidden" name="reason" value={data.reason}/><input type="hidden" name="brand" value={bulkBrand}/><input type="hidden" name="back" value={back}/>
            <Button type="submit" variant="outline" title={`${bulkBrand}: yalnız uygun öneriler birleştirilir`}><CircleCheck data-icon="inline-start" aria-hidden="true"/>Tümünü birleştir ({number(data.acceptableTotal)})</Button>
          </form>}
          {data.names === "conflict" && data.total > 0 && <form action={rejectCandidates}>
            {data.reason && <input type="hidden" name="reason" value={data.reason}/>}{data.brandFilter && <input type="hidden" name="q" value={data.brandFilter}/>}<input type="hidden" name="back" value={back}/>
            <Button type="submit" variant="outline"><CircleAlert data-icon="inline-start" aria-hidden="true"/>Tümünü farklı say ({number(data.total)})</Button>
          </form>}
        </div>}
        {data.candidates.length ? <Table server><caption className="sr-only">Olası aynı ürünler</caption>
          <TableHeader><TableRow><TableHead sortKey="reason" filter={{ param: "scope", options: reasons.map(reason => ({ value: reason, label: candidateReasons[reason] })) }}>Neden</TableHead><TableHead>Başbuğ</TableHead><TableHead>Dinamik</TableHead><TableHead sortKey="similarity" className="text-center" title="Ürün adı benzerliği">Benzerlik</TableHead><TableHead>Karar</TableHead></TableRow></TableHeader>
          <TableBody>{data.candidates.map(item => <TableRow key={`${item.a.id}|${item.b.id}`}>
            <TableCell><div className="flex flex-col items-start gap-1"><span>{candidateReasons[item.reason]}</span><span className="text-muted-foreground">{item.a.brand_label}</span>
              {item.name_conflict && <Badge variant="destructive" title="İki tanım farklı parça türü söylüyor"><CircleAlert data-icon="inline-start" aria-hidden="true"/>Tanımı farklı</Badge>}
              {item.shared_b && <Badge variant="warning" title="Bu Dinamik ürünü başka Başbuğ ürünlerine de önerildi; yalnız birine bağlanabilir"><TriangleAlert data-icon="inline-start" aria-hidden="true"/>Birden çok eş</Badge>}</div></TableCell>
            <TableCell>{side(item.a)}</TableCell>
            <TableCell>{side(item.b)}</TableCell>
            <TableCell className="text-center">{item.name_similarity === null ? "—" : <ToneBadge tone={item.name_similarity >= 0.3 ? "success" : item.name_similarity >= 0.15 ? "neutral" : "warning"}>{percent(item.name_similarity)}</ToneBadge>}</TableCell>
            <TableCell><div className="flex flex-wrap gap-2">{(["same", "different"] as const).map(status => <form key={status} action={decideCandidate}>
              <input type="hidden" name="product_a" value={item.a.id}/><input type="hidden" name="product_b" value={item.b.id}/>
              <input type="hidden" name="status" value={status}/><input type="hidden" name="back" value={back}/>
              <Button type="submit" variant={status === "same" ? "outline" : "ghost"}>{status === "same" ? "Aynı ürün" : "Farklı"}</Button>
            </form>)}</div></TableCell>
          </TableRow>)}</TableBody></Table> : <EmptyState title="İncelenecek öneri yok." icon={<GitCompareArrows/>}/>}
      </CardContent>
      {pager}
    </>;
  } else if ("same" in data) {
    const summary = "summary" in data ? data.summary : undefined, split = "split" in data ? data.split : undefined;
    body = <>
      <CardContent className="flex flex-col gap-4">
        {search("same", "Parça no veya kod", [{ name: "scope", label: "Satıştaki teklif", value: data.scope === "all" ? "" : data.scope, options: [
          { value: "", label: `Tüm teklifler${summary ? ` (${number(summary.all)})` : ""}` },
          { value: "dinamik", label: `Dinamik${summary ? ` (${number(summary.dinamik)})` : ""}` },
          { value: "basbug", label: `Başbuğ${summary ? ` (${number(summary.basbug)})` : ""}` },
          { value: "none", label: `Stok yok${summary ? ` (${number(summary.none)})` : ""}` },
          { value: "split", label: `Elle ayrılan (${number(data.exclusions)})` },
        ] }])}
        {split ? (split.length ? <Table><caption className="sr-only">Ayrılan kayıtlar</caption>
          <TableHeader><TableRow><TableHead>Tedarikçi</TableHead><TableHead>Kod</TableHead><TableHead>Ad</TableHead><TableHead>Karar</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader>
          <TableBody>{split.map(item => <TableRow key={item.id}>
            <TableCell>{suppliers[item.supplier] ?? item.supplier}</TableCell>
            <TableCell className="max-w-44 truncate font-mono" title={item.code}>{item.code}</TableCell>
            <TableCell className="max-w-80 truncate" title={item.name ?? ""}>{item.name || "—"}</TableCell>
            <TableCell className="text-muted-foreground">{date(item.decided_at)}</TableCell>
            <TableCell><form action={undoSplit}><input type="hidden" name="item_id" value={item.id}/><input type="hidden" name="back" value={back}/><Button type="submit" variant="outline">Geri al</Button></form></TableCell>
          </TableRow>)}</TableBody></Table> : <EmptyState title="Elle karar verilmiş kayıt yok." icon={<Boxes/>}/>) : <>
          {"same" in data && data.same.length ? <Table server><caption className="sr-only">{"Başbuğ ve Dinamik'te aynı ürünler"}</caption>
            <TableHeader><TableRow><TableHead>Ürün</TableHead><TableHead sortKey="primary">Başbuğ</TableHead><TableHead>Dinamik</TableHead>
              <TableHead sortKey="selling" filter={{ param: "scope", options: [{ value: "dinamik", label: "Dinamik satışta" }, { value: "basbug", label: "Başbuğ satışta" }, { value: "none", label: "Stok yok" }] }}>Mağazada satılan</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader>
            <TableBody>{data.same.map(group => {
              const primary = group.offers[0], dinamik = group.offers.filter(offer => offer.supplier === "dinamik");
              const saving = group.selling === "dinamik" && group.primary_price && group.selling_price ? Math.round((1 - group.selling_price / group.primary_price) * 100) : 0;
              return <TableRow key={group.primary_id}>
                <TableCell className="max-w-64"><Link className="block truncate font-medium hover:underline" href={`/urun/${group.primary_id}`} target="_blank" rel="noreferrer" title={primary.name}>{primary.name}</Link></TableCell>
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
        {search("dinamik", "Kod veya OEM")}
        {data.dinamik.length ? <Table server><caption className="sr-only">{"Yalnız Dinamik'te olan ürünler"}</caption>
          <TableHeader><TableRow><TableHead sortKey="code">Kod</TableHead><TableHead sortKey="brand">Marka</TableHead><TableHead sortKey="name">Ad</TableHead><TableHead className="text-right">Fiyat</TableHead><TableHead className="text-center">Stok</TableHead><TableHead>Trodo</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader>
          <TableBody>{data.dinamik.map(item => <TableRow key={item.id}>
            <TableCell className="max-w-44 truncate font-mono" title={item.code}><Button variant="link" className="h-auto p-0 font-mono" nativeButton={false} render={<a href={`/urun/${item.id}`} target="_blank" rel="noreferrer"/>}>{item.code}</Button></TableCell>
            <TableCell className="max-w-28 truncate text-muted-foreground" title={item.brand ?? ""}>{item.brand || "—"}</TableCell>
            <TableCell className="max-w-80 truncate" title={item.name ?? ""}>{item.name || "—"}</TableCell>
            <TableCell className="text-right font-medium tabular-nums">{price(item.price_kurus)}</TableCell>
            <TableCell className="text-center"><StockLabel stock={item.available}/></TableCell>
            <TableCell><ToneBadge tone={item.enriched ? "success" : "warning"}>{item.enriched ? "Hazır" : "Bekliyor"}</ToneBadge></TableCell>
            <TableCell>{item.product_id && <Button variant="ghost" nativeButton={false} render={<Link href={`/yonetim/urunler/${item.product_id}#birlestir`}/>}>Eşleştir</Button>}</TableCell>
          </TableRow>)}</TableBody></Table> : <EmptyState title="Ürün bulunamadı." icon={<SearchX/>}/>}
      </CardContent>
      {pager}
    </>;
  } else if ("seta" in data) {
    body = <>
      <CardContent className="flex flex-col gap-4">
        {search("seta", "SETA kodu veya OEM", [{ name: "scope", label: "Bağlantı durumu", value: data.scope === "linked" ? "" : data.scope, options: [
          { value: "", label: "Bağlı" }, { value: "unlinked", label: "Bağlantısız" },
        ] }])}
        {data.seta.length ? <Table server><caption className="sr-only">SETA muadilleri</caption>
          <TableHeader><TableRow><TableHead sortKey="code">SETA kodu</TableHead><TableHead>Ad</TableHead><TableHead sortKey="price" className="text-right">Fiyat</TableHead><TableHead className="text-center">Stok</TableHead><TableHead sortKey="linked" className="text-right">Gösterildiği ürün</TableHead><TableHead>Örnek</TableHead><TableHead><span className="sr-only">Bağlantılar</span></TableHead></TableRow></TableHeader>
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
  const metrics: { icon: LucideIcon; label: string; value: number }[] = stats ? [
    { icon: Tags, label: "Bekleyen markalar", value: data.brandCount.pending },
    { icon: Merge, label: "Ürün önerileri", value: data.pendingCandidates },
    { icon: Boxes, label: "Eşleşen ürünler", value: stats.basbug_dinamik_groups ?? 0 },
    { icon: PackagePlus, label: "Yalnız Dinamik", value: stats.dinamik_only ?? 0 },
    { icon: Link2, label: "SETA muadilleri", value: stats.seta_linked_items ?? 0 },
  ] : [];

  return <div className="flex min-w-0 flex-col gap-4">
    <div className="flex flex-col gap-2">
      <Breadcrumb><BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink render={<Link href="/yonetim"/>}>Yönetim</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator/>
        <BreadcrumbItem><BreadcrumbPage>Ürün eşleştirme</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList></Breadcrumb>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Ürün eşleştirme</h1>
        <form action={refreshMatches}><SupplierRefreshButton label="Yenile" pendingLabel="Eşleştiriliyor…"/></form>
      </div>
    </div>
    {params.refreshed === "1" && notice("Eşleştirme yenilendi.")}
    {params.decided && messages[params.decided] && notice(messages[params.decided])}
    {params.brand && brandMessages[params.brand] && notice(brandMessages[params.brand])}
    {params.split && splitMessages[params.split] && notice(splitMessages[params.split])}
    {params.matched && (params.matched === "bulk" ? notice(`${number(Number(params.count) || 0)} öneri aynı ürün olarak birleştirildi.`)
      : params.matched === "bulk-different" ? notice(`${number(Number(params.count) || 0)} öneri farklı ürün olarak kaydedildi; tekrar önerilmezler.`) : matchedMessages[params.matched] && notice(matchedMessages[params.matched]))}
    {params.error && <Alert variant="destructive" role="alert"><CircleAlert/><AlertDescription>{params.error === "refresh" ? "Eşleştirme tamamlanamadı; önceki sonuçlar korunuyor." : params.error === "brand" ? "Hedef ana marka bulunamadı; adı listede göründüğü gibi yazın." : params.error === "merge" ? "Birleştirilemedi: Dinamik ürünü zaten başka bir ürüne bağlı. Ürün sayfasından kontrol edin." : "İşlem kaydedilemedi."}</AlertDescription></Alert>}
    {!stats ? <EmptyState title="Henüz eşleştirme yok" icon={<Boxes/>}/> : <>
      <Card size="sm"><CardContent>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5" aria-label="Eşleştirme özeti">{metrics.map(metric => <div key={metric.label} className="flex flex-col gap-1">
          <dt className="flex items-center gap-2 text-muted-foreground"><metric.icon className="size-4" aria-hidden="true"/>{metric.label}</dt>
          <dd className="text-2xl font-semibold tabular-nums">{number(metric.value)}</dd>
        </div>)}</dl>
      </CardContent></Card>
      <Tabs value={data.tab} className="min-w-0 gap-3">
        <ScrollArea className="pb-2">
          <TabsList aria-label="Ürün eşleştirme" activateOnFocus={false}>{[
            { value: "brands", label: "Markalar", href: tabHref() },
            { value: "candidates", label: "Öneriler", href: tabHref("candidates") },
            { value: "same", label: "Eşleşenler", href: tabHref("same") },
            { value: "dinamik", label: "Dinamik", href: tabHref("dinamik") },
            { value: "seta", label: "SETA", href: tabHref("seta") },
          ].map(tab => <TabsTrigger key={tab.value} value={tab.value} nativeButton={false} render={<Link href={tab.href} scroll={false}/>}>{tab.label}</TabsTrigger>)}</TabsList>
          <ScrollBar orientation="horizontal"/>
        </ScrollArea>
        <TabsContent value={data.tab}><Card>{body}</Card></TabsContent>
      </Tabs>
    </>}
  </div>;
}
