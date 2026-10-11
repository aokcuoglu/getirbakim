import { Boxes, ChevronLeft, ChevronRight, Copy, GitCompareArrows, Link2, Search, SearchX } from "lucide-react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { AdminPage, AdminPageHeader, AdminPanel, AdminTabs, ButtonLink, EmptyState, PagerLink, Stat, StatGrid, StatusBadge, StatusMessage } from "@/components/admin/ui";
import { SupplierRefreshButton } from "@/components/admin/supplier-refresh-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { productMatchingData, strongSimilarity } from "@/modules/admin/product-matching";
import { money } from "@/modules/store/catalog";
import { decideBrandPair, refreshMatches } from "./actions";

const number = (value: number) => new Intl.NumberFormat("tr-TR").format(value);
const date = (value: Date) => value.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const suppliers: Record<string, string> = { basbug: "Başbuğ", dinamik: "Dinamik", seta: "SETA" };
const decided: Record<string, string> = { same: "Aynı marka olarak kaydedildi; gruplar bir sonraki yenilemede birleşir.", equivalent: "Muadil olarak kaydedildi.", unrelated: "İlgisiz olarak kaydedildi; bu çift tekrar önerilmez." };

export default async function ProductMatching({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = normalizeSearchParams(await searchParams);
  const data = await productMatchingData(params);
  const stats = data.run?.stats;
  const query = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ tab: params.tab, strength: params.strength, scope: params.scope, supplier: params.supplier, q: params.q, ...changes })) if (value) next.set(key, value);
    return `/yonetim/urun-eslestirme${next.size ? `?${next}` : ""}`;
  };
  const back = query({ page: params.page });
  const pager = <nav className="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm" aria-label="Sayfalar">
    <span className="text-muted-foreground tabular-nums">{number(data.total)} kayıt · Sayfa {number(data.page)} / {number(data.pages)}</span>
    <div className="flex gap-1"><PagerLink href={data.page > 1 ? query({ page: String(data.page - 1) }) : null}><ChevronLeft/>Önceki</PagerLink><PagerLink href={data.page < data.pages ? query({ page: String(data.page + 1) }) : null}>Sonraki<ChevronRight/></PagerLink></div>
  </nav>;
  return <AdminPage>
    <AdminPageHeader breadcrumbs={[{ label: "Yönetim", href: "/yonetim" }, { label: "Ürün eşleştirme" }]} title="Ürün eşleştirme"
      description="Başbuğ, Dinamik ve SETA'daki aynı ürünler, marka eşlemeleri ve muadil bağlantıları. Mağazayı henüz etkilemez."
      actions={<form action={refreshMatches}><SupplierRefreshButton label="Eşleştirmeyi yenile" pendingLabel="Eşleştiriliyor (~1 dk)…"/></form>}/>
    {params.refreshed === "1" && <StatusMessage>Eşleştirme yenilendi.</StatusMessage>}
    {params.decided && decided[params.decided] && <StatusMessage>{decided[params.decided]}</StatusMessage>}
    {params.error && <StatusMessage tone="error">{params.error === "refresh" ? "Eşleştirme tamamlanamadı; önceki sonuçlar korunuyor." : "Karar kaydedilemedi."}</StatusMessage>}
    {!stats ? <EmptyState title="Eşleştirme henüz çalıştırılmadı." icon={<Boxes/>}>Sağ üstteki düğmeyle veya <code>npm run products:match</code> ile başlatın.</EmptyState> : <>
      <StatGrid label="Eşleştirme özeti">
        <Stat icon={Boxes} label="Tedarikçiler arası aynı ürün" value={number(stats.cross_supplier_groups)} note={`${number(stats.grouped_items)} kayıt gruplandı · son yenileme ${date(data.run!.completed_at)}`}/>
        <Stat icon={Copy} label="Tedarikçi içi tekrar" value={number(stats.duplicate_groups)} note="Aynı tedarikçide aynı marka + parça no"/>
        <Stat icon={GitCompareArrows} label="İncelenecek marka çifti" value={number(data.strength.strong + data.strength.weak)} note={`${number(data.strength.strong)} güçlü · ${number(data.strength.weak)} zayıf benzerlik · ${number(Object.values(data.decisions).reduce((a, b) => a + b, 0))} karar verildi`} tone={data.strength.strong ? "warning" : "success"}/>
        <Stat icon={Link2} label="Muadil bağlantılı SETA ürünü" value={number(stats.referenced_items)} note={`${number(stats.references)} rakip kodu / OEM referansı`}/>
      </StatGrid>
      <AdminPanel title="Tedarikçi kapsamı" flush>
        <Table><TableHeader><TableRow><TableHead className="pl-4">Tedarikçi</TableHead><TableHead className="text-right">Eşleştirilen kayıt</TableHead><TableHead className="text-right">Bir grupta</TableHead><TableHead className="pr-4 text-right">Başka tedarikçide de var</TableHead></TableRow></TableHeader>
          <TableBody>{data.bySupplier.map(row => <TableRow key={row.supplier}><TableCell className="pl-4 font-medium">{suppliers[row.supplier] ?? row.supplier}</TableCell><TableCell className="text-right tabular-nums">{number(row.items)}</TableCell><TableCell className="text-right tabular-nums">{number(row.grouped)}</TableCell><TableCell className="pr-4 text-right tabular-nums">{number(row.cross)} <span className="text-muted-foreground">(%{row.items ? Math.round(row.cross / row.items * 100) : 0})</span></TableCell></TableRow>)}</TableBody></Table>
      </AdminPanel>
      <Card className="gap-0 py-0">
        <AdminTabs label="Eşleştirme görünümü" tabs={[
          { href: query({ tab: undefined, page: undefined, scope: undefined, supplier: undefined, q: undefined }), label: "Marka çiftleri", count: data.strength.strong + data.strength.weak, current: data.tab === "pairs" },
          { href: query({ tab: "groups", page: undefined, strength: undefined }), label: "Ürün grupları", count: stats.groups, current: data.tab === "groups" },
        ]}/>
        {data.tab === "pairs" ? <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 text-sm text-muted-foreground">
            <p className="max-w-3xl">Aynı parça numarası farklı markalarda geçiyor. <b className="text-foreground">Aynı marka</b>: iki etiket aynı ürünü satar, kayıtları tek üründe birleşir. <b className="text-foreground">Muadil</b>: aynı numaralandırma, farklı ürün (ör. kayış ölçüsü, OEM numarasıyla yan sanayi). <b className="text-foreground">İlgisiz</b>: numaralar rastlantısal. Ürün adı benzerliği gerçek eşlemelerde genelde %{Math.round(strongSimilarity * 100)}’un üzerindedir.</p>
            <AdminTabs label="Benzerlik" className="border-0 px-0" tabs={[
              { href: query({ strength: undefined, page: undefined }), label: "Güçlü benzerlik", count: data.strength.strong, current: !data.weak },
              { href: query({ strength: "weak", page: undefined }), label: "Zayıf benzerlik", count: data.strength.weak, current: data.weak },
            ]}/>
          </div>
          {data.pairs.length ? <Table className="min-w-[960px]"><caption className="sr-only">İncelenecek marka çiftleri</caption>
            <TableHeader><TableRow><TableHead className="pl-4">Marka çifti</TableHead><TableHead className="text-right">Ortak parça no</TableHead><TableHead className="text-right">Ad benzerliği</TableHead><TableHead>Örnekler (parça no · ad A · ad B)</TableHead><TableHead className="pr-4">Karar</TableHead></TableRow></TableHeader>
            <TableBody>{data.pairs.map(pair => <TableRow key={`${pair.brand_a}|${pair.brand_b}`} className="align-top">
              <TableCell className="pl-4 font-medium">{pair.brand_a}<div className="text-muted-foreground">↔ {pair.brand_b}</div></TableCell>
              <TableCell className="text-right tabular-nums">{number(pair.shared_parts)}</TableCell>
              <TableCell className="text-right tabular-nums">{pair.avg_name_similarity === null ? "—" : <StatusBadge tone={pair.avg_name_similarity >= strongSimilarity ? "success" : "neutral"}>%{Math.round(pair.avg_name_similarity * 100)}</StatusBadge>}</TableCell>
              <TableCell className="max-w-[28rem] whitespace-normal text-xs"><ul className="flex flex-col gap-1">{pair.samples.map((sample, index) => <li key={index}><code className="font-mono">{sample.part}</code> · {sample.a || "—"} <span className="text-muted-foreground">·</span> {sample.b || "—"}</li>)}</ul></TableCell>
              <TableCell className="pr-4"><div className="flex flex-wrap gap-1">{([["same", "Aynı marka", "default"], ["equivalent", "Muadil", "outline"], ["unrelated", "İlgisiz", "ghost"]] as const).map(([status, label, variant]) =>
                <form key={status} action={decideBrandPair}><input type="hidden" name="brand_a" value={pair.brand_a}/><input type="hidden" name="brand_b" value={pair.brand_b}/><input type="hidden" name="status" value={status}/><input type="hidden" name="back" value={back}/><Button type="submit" size="sm" variant={variant}>{label}</Button></form>)}</div></TableCell>
            </TableRow>)}</TableBody></Table> : <EmptyState title="Bu görünümde incelenecek marka çifti yok." icon={<GitCompareArrows/>}/>}
          {pager}
        </> : <>
          <form className="flex flex-wrap items-center gap-2 border-b p-3" action="/yonetim/urun-eslestirme">
            <input type="hidden" name="tab" value="groups"/>
            <InputGroup className="w-full sm:w-72"><InputGroupAddon><Search aria-hidden="true"/></InputGroupAddon><InputGroupInput name="q" aria-label="Ara" defaultValue={params.q} placeholder="Parça no veya marka anahtarı" maxLength={80}/></InputGroup>
            <NativeSelect aria-label="Kapsam" name="scope" defaultValue={params.scope || ""}><NativeSelectOption value="">Tedarikçiler arası</NativeSelectOption><NativeSelectOption value="duplicate">Tedarikçi içi tekrar</NativeSelectOption><NativeSelectOption value="all">Tümü</NativeSelectOption></NativeSelect>
            <NativeSelect aria-label="Tedarikçi" name="supplier" defaultValue={params.supplier || ""}><NativeSelectOption value="">Tüm tedarikçiler</NativeSelectOption>{Object.entries(suppliers).map(([key, label]) => <NativeSelectOption key={key} value={key}>{label}</NativeSelectOption>)}</NativeSelect>
            <Button type="submit">Filtrele</Button><ButtonLink variant="ghost" href={query({ tab: "groups", scope: undefined, supplier: undefined, q: undefined, page: undefined })}>Temizle</ButtonLink>
          </form>
          {data.groups.length ? <div className="divide-y">{data.groups.map(group => <section key={`${group.brand}|${group.part_number}`} className="px-4 py-3" aria-label={`${group.brand} ${group.part_number}`}>
            <div className="mb-2 flex flex-wrap items-center gap-2"><code className="font-mono text-sm font-semibold">{group.part_number}</code><span className="text-sm text-muted-foreground">{group.brand}</span>{group.suppliers.map(s => <StatusBadge key={s} tone="info">{suppliers[s] ?? s}</StatusBadge>)}<span className="text-xs text-muted-foreground">{group.members} kayıt</span></div>
            <Table className="min-w-[860px]"><TableHeader><TableRow><TableHead>Tedarikçi</TableHead><TableHead>Kod</TableHead><TableHead>Kaynak marka</TableHead><TableHead>Ad</TableHead><TableHead className="text-right">Kaynak fiyat</TableHead><TableHead>Stok</TableHead><TableHead>Mağaza</TableHead></TableRow></TableHeader>
              <TableBody>{group.items.map(item => <TableRow key={item.supplier_item_id}>
                <TableCell>{suppliers[item.supplier] ?? item.supplier}</TableCell><TableCell className="font-mono text-xs">{item.code}</TableCell><TableCell className="text-xs">{item.source_brand}</TableCell>
                <TableCell className="max-w-80 truncate text-xs" title={item.name ?? ""}>{item.name || "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{item.cost ? `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 4 }).format(Number(item.cost))}${item.currency ? ` ${item.currency}` : ""}` : "—"}</TableCell>
                <TableCell>{item.in_stock === null ? "—" : <StatusBadge tone={item.in_stock ? "success" : "neutral"}>{item.in_stock ? "Var" : "Yok"}</StatusBadge>}</TableCell>
                <TableCell className="tabular-nums">{item.supplier === "dinamik" ? <span className="text-xs text-muted-foreground">Satışta değil</span> : item.sale_price_kurus ? money(item.sale_price_kurus) : <span className="text-xs text-muted-foreground">Satışa kapalı</span>}</TableCell>
              </TableRow>)}</TableBody></Table>
          </section>)}</div> : <EmptyState title="Filtrelere uygun grup bulunamadı." icon={<SearchX/>}/>}
          {pager}
        </>}
      </Card>
    </>}
  </AdminPage>;
}
