import type { ReactNode } from "react";
import { Boxes, ChevronLeft, ChevronRight, GitCompareArrows, Link2, PackagePlus, Search, SearchX } from "lucide-react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { AdminPage, AdminPageHeader, AdminTabs, ButtonLink, EmptyState, PagerLink, Stat, StatGrid, StatusBadge, StatusMessage } from "@/components/admin/ui";
import { SupplierRefreshButton } from "@/components/admin/supplier-refresh-button";
import { DecisionHelp, PairDecision, PairDialog, SetaDialog, StockLabel, type PairRow } from "@/components/admin/product-matching-dialogs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { productMatchingData, strongSimilarity, type Offer } from "@/modules/admin/product-matching";
import { money } from "@/modules/store/catalog";
import { refreshMatches, splitOffers, undoSplit } from "./actions";

const number = (value: number) => new Intl.NumberFormat("tr-TR").format(value);
const date = (value: Date) => new Date(value).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const percent = (value: number | null) => value === null ? null : `%${Math.round(value * 100)}`;
const price = (kurus: number | null | undefined) => kurus ? money(kurus) : "—";
const suppliers: Record<string, string> = { basbug: "Başbuğ", dinamik: "Dinamik", seta: "SETA" };
const messages: Record<string, string> = {
  same: "Aynı marka olarak kaydedildi; ürünler bir sonraki yenilemede birleşir.", equivalent: "Muadil olarak kaydedildi.", unrelated: "İlgisiz olarak kaydedildi; bu çift tekrar önerilmez.",
};
const splitMessages: Record<string, string> = {
  "1": "Ayrıldı: Dinamik kaydı artık mağazada ayrı ürün olarak listeleniyor.", undone: "Ayırma kaldırıldı; bir sonraki yenilemede yeniden birleşir.",
};

function OfferCell({ offer }: { offer: Offer | undefined }) {
  if (!offer) return <span className="text-muted-foreground">—</span>;
  return <div className="min-w-0"><div className="truncate font-mono" title={offer.code}>{offer.code}</div>
    <div className="flex items-center gap-2 tabular-nums"><span className="font-medium">{price(offer.price)}</span><StockLabel stock={offer.available}/></div></div>;
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
  const pager = <nav className="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm" aria-label="Sayfalar">
    <span className="text-muted-foreground tabular-nums">{number(data.total)} kayıt · Sayfa {number(data.page)} / {number(data.pages)}</span>
    <div className="flex gap-1"><PagerLink href={data.page > 1 ? query({ page: String(data.page - 1) }) : null}><ChevronLeft/>Önceki</PagerLink><PagerLink href={data.page < data.pages ? query({ page: String(data.page + 1) }) : null}>Sonraki<ChevronRight/></PagerLink></div>
  </nav>;
  const intro = (text: ReactNode) => <p className="border-b px-4 py-2.5 text-xs text-muted-foreground">{text}</p>;
  const search = (tab: string, placeholder: string, extra?: ReactNode) => <form className="flex items-center gap-2 overflow-x-auto border-b p-3 [&>*]:shrink-0" action="/yonetim/urun-eslestirme">
    <input type="hidden" name="tab" value={tab}/>{params.scope && <input type="hidden" name="scope" value={params.scope}/>}
    <InputGroup className="w-64"><InputGroupAddon><Search aria-hidden="true"/></InputGroupAddon><InputGroupInput name="q" aria-label="Ara" defaultValue={params.q} placeholder={placeholder} maxLength={80}/></InputGroup>
    <Button type="submit">Ara</Button>{params.q && <ButtonLink variant="ghost" href={query({ q: undefined, page: undefined })}>Temizle</ButtonLink>}{extra}
  </form>;
  const pending = data.strength.strong + data.strength.weak;

  let body: ReactNode = null;
  if ("pairs" in data) {
    const pairs: PairRow[] = data.pairs.map(pair => ({ brand_a: pair.brand_a, brand_b: pair.brand_b, shared_parts: number(pair.shared_parts),
      shared_eans: pair.shared_eans ? number(pair.shared_eans) : null, similarity: percent(pair.avg_name_similarity),
      strong: (pair.avg_name_similarity ?? 0) >= strongSimilarity, samples: pair.samples, ean_samples: pair.ean_samples }));
    body = <>
      {intro("Aynı parça numarası farklı tedarikçilerde farklı marka adıyla geçiyor. Aynı markaysa ürünler birleşir; karar tüm ortak parçalara uygulanır ve yenilemeden sonra geçerli olur.")}
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <AdminTabs label="Benzerlik" className="border-0 px-0" tabs={[
          { href: query({ strength: undefined, page: undefined }), label: "Güçlü benzerlik", count: data.strength.strong, current: !data.weak },
          { href: query({ strength: "weak", page: undefined }), label: "Zayıf benzerlik", count: data.strength.weak, current: data.weak },
        ]}/>
        <DecisionHelp/>
      </div>
      {pairs.length ? <div className="overflow-x-auto"><Table className="min-w-[980px] table-fixed text-xs [&_td]:py-1.5"><caption className="sr-only">İncelenecek marka çiftleri</caption>
        <TableHeader><TableRow className="bg-muted/40"><TableHead className="w-32 pl-4">Marka A</TableHead><TableHead className="w-32">Marka B</TableHead><TableHead className="w-20 text-right">Ortak no</TableHead><TableHead className="w-20 text-right" title="Dinamik'te ortak barkod">Ortak barkod</TableHead><TableHead className="w-20 text-center" title="Ürün adı benzerliği">Benzerlik</TableHead><TableHead>Örnek (parça no · A · B)</TableHead><TableHead className="w-[13.5rem]">Karar</TableHead><TableHead className="w-10 pr-3"><span className="sr-only">Örnekler</span></TableHead></TableRow></TableHeader>
        <TableBody>{pairs.map(pair => {
          // Barcode-only pairs share no part number; their first barcode match stands in as the example.
          const ean = pair.ean_samples[0];
          const sample = pair.samples[0] ?? (ean && { part: ean.ean, a: `${ean.part_a} ${ean.a ?? ""}`.trim(), b: `${ean.part_b} ${ean.b ?? ""}`.trim() });
          const sampleText = sample ? `${sample.part} · ${sample.a || "—"} · ${sample.b || "—"}` : "—";
          return <TableRow key={`${pair.brand_a}|${pair.brand_b}`}>
            <TableCell className="truncate pl-4 font-medium" title={pair.brand_a}>{pair.brand_a}</TableCell>
            <TableCell className="truncate font-medium" title={pair.brand_b}>{pair.brand_b}</TableCell>
            <TableCell className="text-right tabular-nums">{pair.shared_parts}</TableCell>
            <TableCell className="text-right tabular-nums">{pair.shared_eans ?? <span className="text-muted-foreground">—</span>}</TableCell>
            <TableCell className="text-center">{pair.similarity ? <StatusBadge tone={pair.strong ? "success" : "neutral"}>{pair.similarity}</StatusBadge> : "—"}</TableCell>
            <TableCell className="truncate text-muted-foreground" title={sampleText}>{sample ? <><span className="font-mono text-foreground">{sample.part}</span> · {sample.a || "—"} · {sample.b || "—"}</> : "—"}</TableCell>
            <TableCell><PairDecision pair={pair} back={back}/></TableCell>
            <TableCell className="pr-3"><PairDialog pair={pair} back={back}/></TableCell>
          </TableRow>;
        })}</TableBody></Table></div> : <EmptyState title="Bu görünümde incelenecek marka çifti yok." icon={<GitCompareArrows/>}/>}
      {pager}
    </>;
  } else if ("same" in data) {
    const summary = "summary" in data ? data.summary : undefined, split = "split" in data ? data.split : undefined;
    body = <>
      {intro("Başbuğ ürününün aynısı Dinamik'te de var. Mağazada tek ürün görünür; fiyat ve stok, stokta olan en ucuz tekliften gelir. Eşleşme yanlışsa “Ayır” deyin: Dinamik kaydı ayrı ürün olur.")}
      <div className="border-b px-3 py-2"><AdminTabs label="Satıştaki teklif" className="border-0 px-0" tabs={[
        { href: query({ scope: undefined, page: undefined }), label: "Tümü", count: summary?.all, current: data.scope === "all" },
        { href: query({ scope: "dinamik", page: undefined }), label: "Dinamik satışta", count: summary?.dinamik, current: data.scope === "dinamik" },
        { href: query({ scope: "basbug", page: undefined }), label: "Başbuğ satışta", count: summary?.basbug, current: data.scope === "basbug" },
        { href: query({ scope: "none", page: undefined }), label: "Stok yok", count: summary?.none, current: data.scope === "none" },
        { href: query({ scope: "split", page: undefined, q: undefined }), label: "Ayrılanlar", count: data.exclusions, current: data.scope === "split" },
      ]}/></div>
      {split ? (split.length ? <div className="overflow-x-auto"><Table className="min-w-[720px] table-fixed text-xs [&_td]:py-1.5"><caption className="sr-only">Ayrılan kayıtlar</caption>
        <TableHeader><TableRow className="bg-muted/40"><TableHead className="w-24 pl-4">Tedarikçi</TableHead><TableHead className="w-44">Kod</TableHead><TableHead>Ad</TableHead><TableHead className="w-32">Ayrıldı</TableHead><TableHead className="w-28 pr-4"><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader>
        <TableBody>{split.map(item => <TableRow key={item.id}>
          <TableCell className="pl-4">{suppliers[item.supplier] ?? item.supplier}</TableCell>
          <TableCell className="truncate font-mono" title={item.code}>{item.code}</TableCell>
          <TableCell className="truncate" title={item.name ?? ""}>{item.name || "—"}</TableCell>
          <TableCell className="text-muted-foreground">{date(item.decided_at)}</TableCell>
          <TableCell className="pr-4"><form action={undoSplit}><input type="hidden" name="item_id" value={item.id}/><input type="hidden" name="back" value={back}/><Button type="submit" size="xs" variant="outline">Geri al</Button></form></TableCell>
        </TableRow>)}</TableBody></Table></div> : <EmptyState title="Ayrılan kayıt yok." icon={<Boxes/>}/>) : <>
        {search("same", "Parça no veya kod")}
        {"same" in data && data.same.length ? <div className="overflow-x-auto"><Table className="min-w-[1000px] table-fixed text-xs [&_td]:py-2 [&_td]:align-top"><caption className="sr-only">{"Başbuğ ve Dinamik'te aynı ürünler"}</caption>
          <TableHeader><TableRow className="bg-muted/40"><TableHead className="pl-4">Ürün</TableHead><TableHead className="w-48">Başbuğ</TableHead><TableHead className="w-48">Dinamik</TableHead><TableHead className="w-40">Mağazada satılan</TableHead><TableHead className="w-20 pr-4"><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader>
          <TableBody>{data.same.map(group => {
            const primary = group.offers[0], dinamik = group.offers.filter(offer => offer.supplier === "dinamik");
            const saving = group.selling === "dinamik" && group.primary_price && group.selling_price ? Math.round((1 - group.selling_price / group.primary_price) * 100) : 0;
            return <TableRow key={group.primary_id}>
              <TableCell className="pl-4"><a className="line-clamp-2 font-medium hover:underline" href={`/urun/${group.primary_id}`} target="_blank" rel="noreferrer" title={primary.name}>{primary.name}</a></TableCell>
              <TableCell><OfferCell offer={primary}/></TableCell>
              <TableCell><OfferCell offer={dinamik[0]}/>{dinamik.length > 1 && <div className="text-muted-foreground">+{dinamik.length - 1} kayıt</div>}</TableCell>
              <TableCell>{group.selling ? <div className="flex flex-col items-start gap-1"><StatusBadge tone={group.selling === "dinamik" ? "success" : "neutral"}>{suppliers[group.selling]}</StatusBadge>
                <span className="tabular-nums">{price(group.selling_price)}{saving > 0 && <span className="text-muted-foreground"> · %{saving} ucuz</span>}</span></div> : <span className="text-muted-foreground">Stok yok</span>}</TableCell>
              <TableCell className="pr-4"><form action={splitOffers}><input type="hidden" name="primary_id" value={group.primary_id}/><input type="hidden" name="back" value={back}/>
                <Button type="submit" size="xs" variant="ghost" title="Yanlış eşleşme: Dinamik kaydı ayrı ürün olsun">Ayır</Button></form></TableCell>
            </TableRow>;
          })}</TableBody></Table></div> : <EmptyState title="Bu görünümde ürün yok." icon={<SearchX/>}/>}
        {pager}
      </>}
    </>;
  } else if ("dinamik" in data) {
    body = <>
      {intro("Başbuğ'da karşılığı bulunmayan Dinamik ürünleri. Mağazada ayrı ürün olarak listelenir; görsel, özellik ve araç bilgisi Trodo zenginleştirmesiyle gelir.")}
      {search("dinamik", "Kod veya OEM")}
      {data.dinamik.length ? <div className="overflow-x-auto"><Table className="min-w-[880px] table-fixed text-xs [&_td]:py-1.5"><caption className="sr-only">{"Yalnız Dinamik'te olan ürünler"}</caption>
        <TableHeader><TableRow className="bg-muted/40"><TableHead className="w-44 pl-4">Kod</TableHead><TableHead className="w-28">Marka</TableHead><TableHead>Ad</TableHead><TableHead className="w-28 text-right">Fiyat</TableHead><TableHead className="w-16 text-center">Stok</TableHead><TableHead className="w-32 pr-4">Trodo</TableHead></TableRow></TableHeader>
        <TableBody>{data.dinamik.map(item => <TableRow key={item.id}>
          <TableCell className="truncate pl-4 font-mono" title={item.code}><a className="hover:underline" href={`/urun/${item.id}`} target="_blank" rel="noreferrer">{item.code}</a></TableCell>
          <TableCell className="truncate text-muted-foreground" title={item.brand ?? ""}>{item.brand || "—"}</TableCell>
          <TableCell className="truncate" title={item.name ?? ""}>{item.name || "—"}</TableCell>
          <TableCell className="text-right font-medium tabular-nums">{price(item.price_kurus)}</TableCell>
          <TableCell className="text-center"><StockLabel stock={item.available}/></TableCell>
          <TableCell className="pr-4"><StatusBadge tone={item.enriched ? "success" : "neutral"}>{item.enriched ? "Zenginleştirildi" : "Bekliyor"}</StatusBadge></TableCell>
        </TableRow>)}</TableBody></Table></div> : <EmptyState title="Ürün bulunamadı." icon={<SearchX/>}/>}
      {pager}
    </>;
  } else if ("seta" in data) {
    body = <>
      {intro("SETA kendi markasıdır; aynı ürün değil muadil olarak gösterilir. Ortak OEM numarası veya SETA'nın rakip kodu üzerinden Başbuğ/Dinamik ürün sayfasında “OEM ve muadil numaraları” bölümünde yer alır.")}
      <div className="border-b px-3 py-2"><AdminTabs label="Bağlantı" className="border-0 px-0" tabs={[
        { href: query({ scope: undefined, page: undefined }), label: "Bağlı", count: stats?.seta_linked_items, current: data.scope === "linked" },
        { href: query({ scope: "unlinked", page: undefined }), label: "Bağlantısız", current: data.scope === "unlinked" },
      ]}/></div>
      {search("seta", "SETA kodu veya OEM")}
      {data.seta.length ? <div className="overflow-x-auto"><Table className="min-w-[900px] table-fixed text-xs [&_td]:py-1.5"><caption className="sr-only">SETA muadilleri</caption>
        <TableHeader><TableRow className="bg-muted/40"><TableHead className="w-36 pl-4">SETA kodu</TableHead><TableHead>Ad</TableHead><TableHead className="w-24 text-right">Fiyat</TableHead><TableHead className="w-16 text-center">Stok</TableHead><TableHead className="w-24 text-right">Gösterildiği ürün</TableHead><TableHead className="w-56">Örnek</TableHead><TableHead className="w-10 pr-3"><span className="sr-only">Bağlantılar</span></TableHead></TableRow></TableHeader>
        <TableBody>{data.seta.map(item => <TableRow key={item.id}>
          <TableCell className="truncate pl-4 font-mono" title={item.code}><a className="hover:underline" href={`/urun/${item.id}`} target="_blank" rel="noreferrer">{item.code}</a></TableCell>
          <TableCell className="truncate" title={item.name ?? ""}>{item.name || "—"}</TableCell>
          <TableCell className="text-right font-medium tabular-nums">{price(item.price_kurus)}</TableCell>
          <TableCell className="text-center"><StockLabel stock={item.available}/></TableCell>
          <TableCell className="text-right tabular-nums">{number(item.linked)}</TableCell>
          <TableCell className="truncate text-muted-foreground" title={item.products.map(product => product.code).join(", ")}>{item.products.slice(0, 2).map(product => product.code).join(", ") || "—"}</TableCell>
          <TableCell className="pr-3">{item.products.length > 0 && <SetaDialog title={`SETA ${item.code}`} description={`${number(item.linked)} ürün sayfasında muadil olarak gösteriliyor`}
            products={item.products.map(product => ({ ...product, supplier: suppliers[product.supplier] ?? product.supplier }))}/>}</TableCell>
        </TableRow>)}</TableBody></Table></div> : <EmptyState title="SETA ürünü bulunamadı." icon={<SearchX/>}/>}
      {pager}
    </>;
  }

  return <AdminPage>
    <AdminPageHeader breadcrumbs={[{ label: "Yönetim", href: "/yonetim" }, { label: "Ürün eşleştirme" }]} title="Ürün eşleştirme"
      description="Başbuğ ana katalogdur. Aynı ürün Dinamik'te de varsa mağazada tek ürün olarak, stokta olan en ucuz fiyatla satılır. Dinamik'e özgü ürünler ayrı listelenir; SETA ürünleri muadil olarak gösterilir."
      actions={<form action={refreshMatches}><SupplierRefreshButton label="Eşleştirmeyi yenile" pendingLabel="Eşleştiriliyor (~1 dk)…"/></form>}/>
    {params.refreshed === "1" && <StatusMessage>Eşleştirme yenilendi.</StatusMessage>}
    {params.decided && messages[params.decided] && <StatusMessage>{messages[params.decided]}</StatusMessage>}
    {params.split && splitMessages[params.split] && <StatusMessage>{splitMessages[params.split]}</StatusMessage>}
    {params.error && <StatusMessage tone="error">{params.error === "refresh" ? "Eşleştirme tamamlanamadı; önceki sonuçlar korunuyor." : "İşlem kaydedilemedi."}</StatusMessage>}
    {!stats ? <EmptyState title="Eşleştirme henüz çalıştırılmadı." icon={<Boxes/>}>Sağ üstteki düğmeyle veya <code>npm run products:match</code> ile başlatın.</EmptyState> : <>
      <StatGrid label="Eşleştirme özeti">
        <Stat icon={GitCompareArrows} label="1 · Marka kararı bekleyen" value={number(pending)} note={`${number(data.strength.strong)} güçlü · ${number(data.strength.weak)} zayıf benzerlik`} tone={data.strength.strong ? "warning" : "success"} href={tabHref()}/>
        <Stat icon={Boxes} label="2 · Başbuğ + Dinamik aynı ürün" value={number(stats.basbug_dinamik_groups ?? 0)} note={`Tek ürün, en uygun teklif · ${date(data.run!.completed_at)}`} href={tabHref("same")}/>
        <Stat icon={PackagePlus} label="3 · Yalnız Dinamik'te" value={number(stats.dinamik_only ?? 0)} note="Ayrı ürün olarak listelenir" href={tabHref("dinamik")}/>
        <Stat icon={Link2} label="4 · SETA muadili" value={number(stats.seta_linked_items ?? 0)} note={`${number(stats.seta_linked_products ?? 0)} Başbuğ/Dinamik kaydında gösteriliyor`} href={tabHref("seta")}/>
      </StatGrid>
      <Card className="gap-0 py-0">
        <AdminTabs label="Eşleştirme adımları" tabs={[
          { href: tabHref(), label: "1 · Marka eşleştirme", count: pending, current: data.tab === "pairs" },
          { href: tabHref("same"), label: "2 · Aynı ürünler", count: stats.basbug_dinamik_groups, current: data.tab === "same" },
          { href: tabHref("dinamik"), label: "3 · Yalnız Dinamik", count: stats.dinamik_only, current: data.tab === "dinamik" },
          { href: tabHref("seta"), label: "4 · SETA muadilleri", count: stats.seta_linked_items, current: data.tab === "seta" },
        ]}/>
        {body}
      </Card>
    </>}
  </AdminPage>;
}
