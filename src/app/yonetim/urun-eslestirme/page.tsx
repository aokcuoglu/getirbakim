import type { ReactNode } from "react";
import Link from "next/link";
import { Boxes, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, GitCompareArrows, Info, Link2, Merge, PackagePlus, RefreshCw, SearchX, Split, Store, Tags, type LucideIcon } from "lucide-react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { SubmitButton } from "@/components/admin/submit-button";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatDateTime, formatNumber } from "@/modules/admin/format";
import { BrandLabelList } from "@/components/admin/brand-label-list";
import { BrandDialog, ConfirmBrand, MergeSuggestion, SetaDialog, StockLabel, type BrandRow } from "@/components/admin/product-matching-dialogs";
import { ProductMatchingFilters, type MatchingFilter } from "@/components/admin/product-matching-filters";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { candidateNames, candidateReasons, productMatchingData, type BrandSuggestion, type CandidateNames, type CandidateReason, type Offer } from "@/modules/admin/product-matching";
import { money } from "@/modules/store/catalog";
import { acceptCandidates, decideCandidate, rejectCandidates, refreshMatches, splitOffer, undoSplit } from "./actions";

const number = formatNumber;
const percent = (value: number | null) => value === null ? null : `%${Math.round(value * 100)}`;
const price = (kurus: number | null | undefined) => kurus ? money(kurus) : "—";
const suppliers: Record<string, string> = { basbug: "Başbuğ", dinamik: "Dinamik", seta: "SETA", manual: "Manuel liste" };
const brandMessages: Record<string, string> = {
  confirmed: "Ana marka onaylandı.", renamed: "Ana marka adı güncellendi.", moved: "Etiket taşındı; ürünler bir sonraki yenilemede yeni ana markaya göre gruplanır.",
  created: "Etiket ayrı ana marka oldu; ürünler bir sonraki yenilemede ayrılır.", merged: "Ana markalar birleşti; ürünler bir sonraki yenilemede birleşir.",
};
const brandSuppliers = ["basbug", "dinamik", "seta", "manual"] as const;
const matchedMessages: Record<string, string> = {
  same: "Aynı ürün olarak birleştirildi; mağazada tek ürün olarak, en uygun teklifle satılıyor.", different: "Farklı ürün olarak kaydedildi; bu çift tekrar önerilmez.",
};
const splitMessages: Record<string, string> = {
  "1": "Ayrıldı: kayıt artık kendi ürünü olarak listeleniyor; bu çift tekrar önerilmez. Elle kararlar görünümünden geri alabilirsiniz.", undone: "Karar geri alındı; kayıt kendi ürününe döndü.",
};

const manualBadge = <StatusBadge tone="info" icon={Merge} title="Elle karar verilmiş kayıt; eşleşmeleri yenilemek yerini değiştirmez">Elle</StatusBadge>;

function OfferCell({ offer }: { offer: Offer | undefined }) {
  if (!offer) return <span className="text-muted-foreground">—</span>;
  return <div className="flex min-w-0 flex-col gap-1"><span className="max-w-48 truncate font-mono" title={offer.code}>{offer.code}</span>
    <span className="flex items-center gap-2 tabular-nums"><span className="font-medium">{price(offer.price)}</span><StockLabel stock={offer.available}/></span></div>;
}

// Why a brand was suggested: shared part numbers when they decided it, else the name.
const suggestionEvidence = (suggestion: BrandSuggestion) => suggestion.shared_parts >= 3 && suggestion.shared_parts >= suggestion.parts / 2
  ? `${number(suggestion.shared_parts)}/${number(suggestion.parts)} parça no ortak` : `ad benzer${suggestion.shared_parts ? ` · ${number(suggestion.shared_parts)} parça no ortak` : ""}`;

function EmptyState({ title, icon, clearHref }: { title: string; icon: ReactNode; clearHref?: string }) {
  return <Empty><EmptyHeader><EmptyMedia variant="icon">{icon}</EmptyMedia><EmptyTitle>{title}</EmptyTitle></EmptyHeader>
    {clearHref && <EmptyContent><Button variant="outline" nativeButton={false} render={<Link href={clearHref} scroll={false}/>}>Filtreyi temizle</Button></EmptyContent>}</Empty>;
}

export default async function ProductMatching({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = normalizeSearchParams(await searchParams);
  const data = await productMatchingData(params);
  const stats = data.run?.stats;
  // The kind filter belongs to the manual decisions view only.
  const kind = "decisions" in data ? params.kind : undefined;
  const linked = "same" in data && data.linked ? "manual" : undefined;
  const query = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ tab: params.tab, scope: params.scope, names: params.names, q: params.q, sort: params.sort, dir: params.dir, kind, linked, ...changes })) if (value) next.set(key, value);
    return `/yonetim/urun-eslestirme${next.size ? `?${next}` : ""}`;
  };
  const tabHref = (tab?: string) => query({ tab, page: undefined, scope: undefined, names: undefined, q: undefined, sort: undefined, dir: undefined, kind: undefined, linked: undefined });
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
  const search = (tab: string, placeholder: string, filters?: MatchingFilter[], searchable = true) => <ProductMatchingFilters
    key={`${tab}|${params.q}|${params.scope}|${params.names}|${params.sort}|${params.dir}|${kind}|${linked}`}
    params={{ tab, q: searchable ? params.q : undefined, scope: params.scope, names: params.names, sort: params.sort, dir: params.dir, kind, linked }}
    placeholder={placeholder} filters={filters} searchable={searchable} resetHref={query({ q: undefined, scope: undefined, names: undefined, kind: undefined, linked: undefined, page: undefined })}/>;
  let body: ReactNode = null;
  if ("brands" in data) {
    const rows: BrandRow[] = data.brands.map(brand => ({ id: brand.id, key: brand.key, name: brand.name, items: number(brand.items), pending: brand.pending,
      fresh: brand.fresh, suggestion: brand.suggestion && { id: brand.suggestion.id, name: brand.suggestion.name, evidence: suggestionEvidence(brand.suggestion) } }));
    body = <>
      <CardContent className="flex flex-col gap-4">
        {search("brands", "Marka veya etiket", [{ name: "scope", label: "Marka durumu", value: data.scope,
          defaultValue: data.brandCount.pending ? "pending" : "all", options: [
          { value: "pending", label: `Bekleyen (${number(data.brandCount.pending)})` },
          { value: "single", label: `Tek tedarikçi (${number(data.brandCount.single)})` },
          { value: "all", label: `Tüm markalar (${number(data.brandCount.all)})` },
        ] }])}
        {rows.length ? <Table server><caption className="sr-only">Ana markalar ve tedarikçi etiketleri</caption>
          <TableHeader><TableRow><TableHead sortKey="name">Ana marka</TableHead>{brandSuppliers.map(supplier => <TableHead key={supplier}>{suppliers[supplier]}</TableHead>)}<TableHead sortKey="items" className="text-right">Kayıt</TableHead><TableHead>Durum</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader>
          <TableBody>{rows.map((brand, index) => <TableRow key={brand.id}>
            <TableCell className="max-w-56"><div className="flex min-w-0 flex-col gap-1"><span className="truncate font-medium" title={brand.name}>{brand.name}</span>
              {brand.suggestion && <span className="truncate text-muted-foreground" title={`${brand.suggestion.name}: ${brand.suggestion.evidence}`}>Benzer: {brand.suggestion.name} · {brand.suggestion.evidence}</span>}</div></TableCell>
            {brandSuppliers.map(supplier => {
              return <TableCell key={supplier}><BrandLabelList brand={brand.name} supplier={suppliers[supplier]} labels={data.brands[index].labels.filter(label => label.supplier === supplier).map(({ label, items, method }) => ({ label, items: number(items), method }))}/></TableCell>;
            })}
            <TableCell className="text-right tabular-nums">{brand.items}</TableCell>
            <TableCell>{brand.fresh ? <StatusBadge tone="info">Yeni marka</StatusBadge> : brand.pending ? <StatusBadge tone="warning">Otomatik</StatusBadge> : <StatusBadge tone="success">Onaylı</StatusBadge>}</TableCell>
            <TableCell><div className="flex flex-wrap items-center gap-1">{brand.suggestion && <MergeSuggestion id={brand.id} suggestion={brand.suggestion} back={back}/>}{brand.pending && <ConfirmBrand id={brand.id} back={back}/>}<BrandDialog key={`${brand.id}|${brand.name}|${data.brands[index].labels.length}|${data.brands[index].labels.filter(label => label.method === "auto").length}`} brand={brand} back={back}/></div></TableCell>
          </TableRow>)}</TableBody></Table> : <EmptyState title="Bu görünümde ana marka yok." icon={<Tags/>}/>}
      </CardContent>
      {pager}
    </>;
  } else if ("candidates" in data) {
    const reasons = Object.keys(candidateReasons) as CandidateReason[], nameKinds = Object.keys(candidateNames) as CandidateNames[];
    const bulkBrand = data.brandFilter && data.reason && data.candidates.length > 0 && data.candidates.every(item => item.brand === data.brandFilter) ? data.brandFilter : null;
    const side = (item: { id: string; brand_label: string; code: string; name: string | null; suppliers: string[]; price_kurus: number | null; available: boolean | null }) =>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="flex flex-wrap gap-1">{item.suppliers.map(supplier => <Badge key={supplier} variant="secondary">{suppliers[supplier] ?? supplier}</Badge>)}</span>
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
        {data.reason === "suffix" && <Alert variant="info"><Info aria-hidden="true"/><AlertDescription>Yalnız incelenmiş güvenli ek desenleri (ör. Ford renk ekleri, MAYSAN MM/WM/PM, OSRAM 1BL) topluca birleştirilebilir; diğerlerini tek tek karara bağlayın. Bilinen farklı parça desenleri (ör. FEBI 100261 ve 1002610, OSRAM -2HB/-2BL) önerilmez.</AlertDescription></Alert>}
        {(bulkBrand || data.names === "conflict") && <div className="flex flex-wrap items-center gap-2">
          {bulkBrand && data.reason && data.bulkAllowed && data.names !== "conflict" && <div className="flex flex-wrap items-center gap-2">
            {data.acceptableTotal > 0 && <form action={acceptCandidates}>
              <input type="hidden" name="reason" value={data.reason}/><input type="hidden" name="brand" value={bulkBrand}/><input type="hidden" name="back" value={back}/>
              <SubmitButton variant="outline" title={`${bulkBrand}: ${data.bulkPartial ? "yalnız güvenli ek desenleri birleştirilir; " : ""}tanımı farklı ve birden çok eşi/kodu olan öneriler atlanır`} icon={<CircleCheck data-icon="inline-start" aria-hidden="true"/>}>{data.bulkPartial ? "Güvenli olanları birleştir" : "Tümünü birleştir"} ({number(data.acceptableTotal)})</SubmitButton>
            </form>}
            {data.acceptableTotal < data.total && <span className="text-muted-foreground tabular-nums">{number(data.total - data.acceptableTotal)} öneri tek tek karar bekliyor ({data.bulkPartial ? "güvenli sayılmayan son ek, " : ""}farklı tanım veya birden çok eş/kod)</span>}
          </div>}
          {data.names === "conflict" && data.total > 0 && <form action={rejectCandidates}>
            {data.reason && <input type="hidden" name="reason" value={data.reason}/>}{data.brandFilter && <input type="hidden" name="q" value={data.brandFilter}/>}<input type="hidden" name="back" value={back}/>
            <SubmitButton variant="outline" icon={<CircleAlert data-icon="inline-start" aria-hidden="true"/>}>Tümünü farklı say ({number(data.total)})</SubmitButton>
          </form>}
        </div>}
        {data.candidates.length ? <Table server><caption className="sr-only">Olası aynı ürünler</caption>
          <TableHeader><TableRow><TableHead sortKey="reason" filter={{ param: "scope", options: reasons.map(reason => ({ value: reason, label: candidateReasons[reason] })) }}>Neden</TableHead><TableHead title="Aynı ürün denirse bu ürün korunur">Mevcut ürün</TableHead><TableHead title="Aynı ürün denirse bu ürün mevcut ürüne katılır">Önerilen eş</TableHead><TableHead sortKey="similarity" className="text-center" title="Ürün adı benzerliği">Benzerlik</TableHead><TableHead>Karar</TableHead></TableRow></TableHeader>
          <TableBody>{data.candidates.map(item => <TableRow key={`${item.a.id}|${item.b.id}`}>
            <TableCell><div className="flex flex-col items-start gap-1"><span>{candidateReasons[item.reason]}</span><span className="text-muted-foreground">{item.a.brand_label}</span>
              {item.name_conflict && <StatusBadge tone="error" title="İki tanım farklı parça türü söylüyor">Tanımı farklı</StatusBadge>}
              {item.shared_b && <StatusBadge tone="warning" title="Bu ürün başka ürünlere de önerildi; yalnız birine bağlanabilir">Birden çok eş</StatusBadge>}
              {item.multi_a && <StatusBadge tone="warning" title="Bu ürüne farklı kodlu birden çok Dinamik ürünü öneriliyor veya bağlı; toplu birleştirmede atlanır">Birden çok kod</StatusBadge>}
              {item.suffix_bulk && <StatusBadge tone="success" title="İncelenmiş güvenli ek deseni; topluca birleştirilebilir">Güvenli ek</StatusBadge>}</div></TableCell>
            <TableCell>{side(item.a)}</TableCell>
            <TableCell>{side(item.b)}</TableCell>
            <TableCell className="text-center">{item.name_similarity === null ? "—" : <StatusBadge tone={item.name_similarity >= 0.3 ? "success" : item.name_similarity >= 0.15 ? "neutral" : "warning"}>{percent(item.name_similarity)}</StatusBadge>}</TableCell>
            <TableCell><div className="flex flex-wrap gap-2">{(["same", "different"] as const).map(status => <form key={status} action={decideCandidate}>
              <input type="hidden" name="product_a" value={item.a.id}/><input type="hidden" name="product_b" value={item.b.id}/>
              <input type="hidden" name="status" value={status}/><input type="hidden" name="back" value={back}/>
              <SubmitButton variant={status === "same" ? "outline" : "ghost"}>{status === "same" ? "Aynı ürün" : "Farklı"}</SubmitButton>
            </form>)}</div></TableCell>
          </TableRow>)}</TableBody></Table> : <EmptyState title="İncelenecek öneri yok." icon={<GitCompareArrows/>}/>}
      </CardContent>
      {pager}
    </>;
  } else if ("same" in data) {
    const summary = data.summary, decisions = "decisions" in data ? data.decisions : undefined;
    body = <>
      <CardContent className="flex flex-col gap-4">
        {search("same", decisions ? "Kod, parça no veya ad" : "Parça no veya kod", [{ name: "scope", label: "Satıştaki teklif", value: data.scope === "all" ? "" : data.scope, options: [
          { value: "", label: `Tüm teklifler${summary ? ` (${number(summary.all)})` : ""}` },
          { value: "dinamik", label: `Dinamik${summary ? ` (${number(summary.dinamik)})` : ""}` },
          { value: "basbug", label: `Başbuğ${summary ? ` (${number(summary.basbug)})` : ""}` },
          { value: "none", label: `Stok yok${summary ? ` (${number(summary.none)})` : ""}` },
          { value: "manual", label: `Elle kararlar (${number(data.exclusions)})` },
        ] }, ...decisions ? [] : [{ name: "linked", label: "Bağlantı türü", value: linked ?? "", options: [
          { value: "", label: "Tüm bağlantılar" },
          { value: "manual", label: `Elle bağlı teklifi olanlar${summary ? ` (${number(summary.manual)})` : ""}` },
        ] }]])}
        {decisions ? (decisions.length ? <Table server><caption className="sr-only">Elle kararlar</caption>
          <TableHeader><TableRow><TableHead sortKey="kind" filter={{ param: "kind", options: [{ value: "merge", label: "Birleştirme" }, { value: "split", label: "Ayırma" }] }}>Karar</TableHead><TableHead sortKey="supplier">Tedarikçi</TableHead><TableHead sortKey="code">Kayıt</TableHead><TableHead>Bağlı ürün</TableHead><TableHead sortKey="decider">Karar veren</TableHead><TableHead sortKey="decided">Tarih</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader>
          <TableBody>{decisions.map(item => <TableRow key={item.id}>
            <TableCell>{item.kind === "merge" ? <StatusBadge tone="info" icon={Merge} title="Başka bir ürüne elle bağlandı">Birleştirme</StatusBadge>
              : <StatusBadge tone="neutral" icon={Split} title="Kendi ürünü olarak elle ayrıldı">Ayırma</StatusBadge>}</TableCell>
            <TableCell>{suppliers[item.supplier] ?? item.supplier}</TableCell>
            <TableCell className="max-w-56"><div className="flex min-w-0 flex-col gap-1"><span className="truncate font-mono" title={item.code}>{item.code}</span>
              <span className="truncate text-muted-foreground" title={item.name ?? ""}>{item.name || "—"}</span></div></TableCell>
            <TableCell className="max-w-64"><div className="flex min-w-0 flex-col gap-1">
              <Link className="truncate font-mono underline-offset-4 hover:underline" href={`/yonetim/urunler/${item.product_id}`} title={`${item.product_label} ${item.product_code}`}>{item.product_label} {item.product_code}</Link>
              <span className="truncate text-muted-foreground" title={item.product_name ?? ""}>{item.product_name || "—"}</span></div></TableCell>
            <TableCell className="max-w-48"><span className={item.decided_by_name ? "block truncate" : "block truncate text-muted-foreground"} title={item.decided_by_name ?? "Karar veren kaydedilmemiş"}>{item.decided_by_name ?? "Bilinmiyor"}</span></TableCell>
            <TableCell className="text-muted-foreground tabular-nums">{formatDateTime(item.decided_at)}</TableCell>
            <TableCell><form action={undoSplit}><input type="hidden" name="item_id" value={item.id}/><input type="hidden" name="back" value={back}/><SubmitButton variant="outline" aria-label={`${item.code} kararını geri al`}>Geri al</SubmitButton></form></TableCell>
          </TableRow>)}</TableBody></Table> : <EmptyState title={params.q && kind ? "Arama ve filtreyle eşleşen elle karar yok." : kind ? "Bu filtreyle eşleşen elle karar yok." : params.q ? "Aramayla eşleşen elle karar yok." : "Elle karar verilmiş kayıt yok."} icon={<Boxes/>} clearHref={kind ? query({ kind: undefined, page: undefined }) : undefined}/>)
          : data.same.length ? <Table server><caption className="sr-only">{"Başbuğ ve Dinamik'te aynı ürünler"}</caption>
            <TableHeader><TableRow><TableHead>Ürün</TableHead><TableHead sortKey="primary">Başbuğ</TableHead><TableHead filter={{ param: "linked", options: [{ value: "manual", label: "Elle bağlı teklifi olanlar" }] }} title="Gruba bağlı diğer tedarikçi kayıtları; Ayır yalnız o kaydı gruptan çıkarır. Elle: marka ve parça numarası eşleşmesiyle değil, yönetici kararıyla bağlandı.">Bağlı teklifler</TableHead>
              <TableHead sortKey="selling" filter={{ param: "scope", options: [{ value: "dinamik", label: "Dinamik satışta" }, { value: "basbug", label: "Başbuğ satışta" }, { value: "none", label: "Stok yok" }] }}>Mağazada satılan</TableHead></TableRow></TableHeader>
            <TableBody>{data.same.map(group => {
              const primary = group.offers[0];
              const saving = group.selling === "dinamik" && group.primary_price && group.selling_price ? Math.round((1 - group.selling_price / group.primary_price) * 100) : 0;
              return <TableRow key={group.primary_id}>
                <TableCell className="max-w-64"><Link className="block truncate font-medium hover:underline" href={`/urun/${group.primary_id}`} target="_blank" rel="noreferrer" title={primary.name}>{primary.name}</Link></TableCell>
                <TableCell><div className="flex flex-col items-start gap-1">{primary.manual && manualBadge}<OfferCell offer={primary}/></div></TableCell>
                <TableCell><div className="flex flex-col gap-3">{group.offers.slice(1).map(offer => <div key={offer.id} className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col items-start gap-1"><div className="flex flex-wrap items-center gap-1"><Badge variant="secondary">{suppliers[offer.supplier] ?? offer.supplier}</Badge>{offer.manual && manualBadge}</div><OfferCell offer={offer}/></div>
                  <form action={splitOffer}><input type="hidden" name="item_id" value={offer.id}/><input type="hidden" name="primary_id" value={group.primary_id}/><input type="hidden" name="back" value={back}/>
                    <SubmitButton variant="ghost" size="sm" title="Yanlış eşleşme: yalnız bu kayıt kendi ürününe dönsün" aria-label={`${offer.code} kaydını ayır`}>Ayır</SubmitButton></form>
                </div>)}</div></TableCell>
                <TableCell>{group.selling ? <div className="flex flex-col items-start gap-1"><StatusBadge tone={group.selling === "dinamik" ? "success" : "neutral"} icon={group.selling === "dinamik" ? undefined : Store}>{suppliers[group.selling]}</StatusBadge>
                  <span className="tabular-nums">{price(group.selling_price)}{saving > 0 && <span className="text-muted-foreground"> · %{saving} ucuz</span>}</span></div> : <span className="text-muted-foreground">Stok yok</span>}</TableCell>
              </TableRow>;
            })}</TableBody></Table> : <EmptyState title={linked ? (params.q || data.scope !== "all" ? "Arama ve filtreyle eşleşen grup yok." : "Bu filtreyle eşleşen grup yok.") : "Bu görünümde ürün yok."} icon={<SearchX/>} clearHref={linked ? query({ q: undefined, scope: undefined, linked: undefined, page: undefined }) : undefined}/>}
      </CardContent>
      {pager}
    </>;
  } else if ("dinamik" in data) {
    body = <>
      <CardContent className="flex flex-col gap-4">
        {search("dinamik", "Kod veya OEM")}
        {data.dinamik.length ? <Table server><caption className="sr-only">{"Yalnız Dinamik'te olan ürünler"}</caption>
          <TableHeader><TableRow><TableHead sortKey="code">Kod</TableHead><TableHead sortKey="brand">Marka</TableHead><TableHead sortKey="name">Ad</TableHead><TableHead className="text-right">Fiyat</TableHead><TableHead className="text-center">Stok</TableHead><TableHead>Trodo</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader>
          <TableBody>{data.dinamik.map(item => <TableRow key={item.id}>
            <TableCell className="max-w-44 truncate font-mono" title={item.code}><Link className="font-medium hover:underline" href={`/urun/${item.id}`} target="_blank" rel="noreferrer">{item.code}</Link></TableCell>
            <TableCell className="max-w-28 truncate text-muted-foreground" title={item.brand ?? ""}>{item.brand || "—"}</TableCell>
            <TableCell className="max-w-80 truncate" title={item.name ?? ""}>{item.name || "—"}</TableCell>
            <TableCell className="text-right font-medium tabular-nums">{price(item.price_kurus)}</TableCell>
            <TableCell className="text-center"><StockLabel stock={item.available}/></TableCell>
            <TableCell><StatusBadge tone={item.enriched ? "success" : "warning"}>{item.enriched ? "Hazır" : "Bekliyor"}</StatusBadge></TableCell>
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
            <TableCell className="max-w-36 truncate font-mono" title={item.code}><Link className="font-medium hover:underline" href={`/urun/${item.id}`} target="_blank" rel="noreferrer">{item.code}</Link></TableCell>
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

  const notice = (text: ReactNode) => <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>{text}</AlertDescription></Alert>;
  const metrics: { icon: LucideIcon; label: string; value: number }[] = stats ? [
    { icon: Tags, label: "Bekleyen markalar", value: data.brandCount.pending },
    { icon: Merge, label: "Ürün önerileri", value: data.pendingCandidates },
    { icon: Boxes, label: "Eşleşen ürünler", value: stats.basbug_dinamik_groups ?? 0 },
    { icon: PackagePlus, label: "Yalnız Dinamik", value: stats.dinamik_only ?? 0 },
    { icon: Link2, label: "SETA muadilleri", value: stats.seta_linked_items ?? 0 },
  ] : [];

  return <div className="flex min-w-0 flex-col gap-4">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 max-w-3xl flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Ürün eşleştirme</h1>
        <p className="text-muted-foreground">Başbuğ, Dinamik ve SETA kayıtlarını aynı ürün altında toplayan marka, ürün ve muadil kararları.</p>
      </div>
      <form action={refreshMatches}><input type="hidden" name="back" value={back}/><SubmitButton icon={<RefreshCw data-icon="inline-start" aria-hidden="true"/>} pendingLabel="Eşleştiriliyor…">Yenile</SubmitButton></form>
    </div>
    {params.refreshed === "1" && notice("Eşleştirme yenilendi.")}
    {params.brand && brandMessages[params.brand] && notice(brandMessages[params.brand])}
    {params.split && splitMessages[params.split] && notice(splitMessages[params.split])}
    {params.matched && (params.matched === "bulk" ? notice(`${number(Number(params.count) || 0)} öneri aynı ürün olarak birleştirildi.${Number(params.carried_hidden) > 0
        ? ` ${number(Number(params.carried_hidden))} tanesinde birleşen ürün mağazada gizli olduğu için gizlilik hedef ürüne taşındı; hedef ürünler artık mağazada görünmüyor.` : ""}${Number(params.images) > 0 ? ` ${number(Number(params.images))} görsel taşındı.` : ""}`)
      : params.matched === "bulk-different" ? notice(`${number(Number(params.count) || 0)} öneri farklı ürün olarak kaydedildi; tekrar önerilmezler.`)
      : matchedMessages[params.matched] && notice(`${matchedMessages[params.matched]}${params.matched === "same" && params.carried_hidden === "1" ? " Birleşen ürün mağazada gizliydi; gizlilik hedef ürüne taşındı, ürün artık mağazada görünmüyor." : ""}${params.matched === "same" && params.images ? params.images === "kept" ? " Hedefte görsel olduğu için birleşen ürünün görselleri taşınmadı." : ` ${number(Number(params.images) || 0)} görsel taşındı.` : ""}`))}
    {params.error && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{params.error === "refresh" ? "Eşleştirme tamamlanamadı; önceki sonuçlar korunuyor." : params.error === "brand" ? "Hedef ana marka bulunamadı; adı listede göründüğü gibi yazın." : params.error === "merge" ? "Birleştirilemedi: Dinamik ürünü zaten başka bir ürüne bağlı. Ürün sayfasından kontrol edin." : params.error === "split" ? "Ayrılamadı: kayıt artık bu grupta değil. Listeyi yenileyip tekrar deneyin." : "İşlem kaydedilemedi."}</AlertDescription></Alert>}
    {!stats ? <EmptyState title="Henüz eşleştirme yok" icon={<Boxes/>}/> : <>
      <Card size="sm"><CardContent>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5" aria-label="Eşleştirme özeti">{metrics.map(metric => <div key={metric.label} className="flex flex-col gap-1">
          <dt className="flex items-center gap-2 text-muted-foreground"><metric.icon className="size-4" aria-hidden="true"/>{metric.label}</dt>
          <dd className="text-2xl font-semibold tabular-nums">{number(metric.value)}</dd>
        </div>)}</dl>
      </CardContent></Card>
      <Tabs value={data.tab} className="min-w-0 gap-3">
        <ScrollArea className="h-10">
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
