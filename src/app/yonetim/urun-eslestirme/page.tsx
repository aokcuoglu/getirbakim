import { Boxes, ChevronLeft, ChevronRight, Copy, GitCompareArrows, Link2, Search, SearchX } from "lucide-react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { AdminPage, AdminPageHeader, AdminPanel, AdminTabs, ButtonLink, EmptyState, PagerLink, Stat, StatGrid, StatusBadge, StatusMessage } from "@/components/admin/ui";
import { SupplierRefreshButton } from "@/components/admin/supplier-refresh-button";
import { DecisionHelp, GroupDialog, PairDecision, PairDialog, StockLabel, type PairRow } from "@/components/admin/product-matching-dialogs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { productMatchingData, strongSimilarity, type GroupMember } from "@/modules/admin/product-matching";
import { money } from "@/modules/store/catalog";
import { refreshMatches } from "./actions";

const number = (value: number) => new Intl.NumberFormat("tr-TR").format(value);
const date = (value: Date) => value.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const percent = (value: number | null) => value === null ? null : `%${Math.round(value * 100)}`;
const suppliers: Record<string, string> = { basbug: "Başbuğ", dinamik: "Dinamik", seta: "SETA" };
const decided: Record<string, string> = { same: "Aynı marka olarak kaydedildi; gruplar bir sonraki yenilemede birleşir.", equivalent: "Muadil olarak kaydedildi.", unrelated: "İlgisiz olarak kaydedildi; bu çift tekrar önerilmez." };
// Source cost as the supplier states it; Dinamik's currency/VAT meaning is not verified, so it carries no unit.
const cost = (member: GroupMember) => member.cost ? `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 4 }).format(Number(member.cost))}${member.currency ? ` ${member.currency}` : ""}` : "—";
const sale = (member: GroupMember) => member.supplier === "dinamik" ? "Satışta değil" : member.sale_price_kurus ? money(member.sale_price_kurus) : "Satışa kapalı";

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
  const pairs: PairRow[] = data.pairs.map(pair => ({ brand_a: pair.brand_a, brand_b: pair.brand_b, shared_parts: number(pair.shared_parts),
    similarity: percent(pair.avg_name_similarity), strong: (pair.avg_name_similarity ?? 0) >= strongSimilarity, samples: pair.samples }));
  return <AdminPage>
    <AdminPageHeader breadcrumbs={[{ label: "Yönetim", href: "/yonetim" }, { label: "Ürün eşleştirme" }]} title="Ürün eşleştirme"
      description="Başbuğ, Dinamik ve SETA'daki aynı ürünler, marka eşlemeleri ve muadil bağlantıları. Mağazayı henüz etkilemez."
      actions={<form action={refreshMatches}><SupplierRefreshButton label="Eşleştirmeyi yenile" pendingLabel="Eşleştiriliyor (~1 dk)…"/></form>}/>
    {params.refreshed === "1" && <StatusMessage>Eşleştirme yenilendi.</StatusMessage>}
    {params.decided && decided[params.decided] && <StatusMessage>{decided[params.decided]}</StatusMessage>}
    {params.error && <StatusMessage tone="error">{params.error === "refresh" ? "Eşleştirme tamamlanamadı; önceki sonuçlar korunuyor." : "Karar kaydedilemedi."}</StatusMessage>}
    {!stats ? <EmptyState title="Eşleştirme henüz çalıştırılmadı." icon={<Boxes/>}>Sağ üstteki düğmeyle veya <code>npm run products:match</code> ile başlatın.</EmptyState> : <>
      <StatGrid label="Eşleştirme özeti">
        <Stat icon={Boxes} label="Tedarikçiler arası aynı ürün" value={number(stats.cross_supplier_groups)} note={`${number(stats.grouped_items)} kayıt gruplandı · ${date(data.run!.completed_at)}`}/>
        <Stat icon={Copy} label="Tedarikçi içi tekrar" value={number(stats.duplicate_groups)} note="Aynı tedarikçide aynı marka + parça no"/>
        <Stat icon={GitCompareArrows} label="İncelenecek marka çifti" value={number(data.strength.strong + data.strength.weak)} note={`${number(data.strength.strong)} güçlü · ${number(data.strength.weak)} zayıf · ${number(Object.values(data.decisions).reduce((a, b) => a + b, 0))} karar`} tone={data.strength.strong ? "warning" : "success"}/>
        <Stat icon={Link2} label="Muadil bağlantılı SETA ürünü" value={number(stats.referenced_items)} note={`${number(stats.references)} rakip kodu / OEM referansı`}/>
      </StatGrid>
      <AdminPanel title="Tedarikçi kapsamı" flush>
        <Table className="table-fixed text-xs [&_td]:py-1.5"><TableHeader><TableRow className="bg-muted/40"><TableHead className="pl-4">Tedarikçi</TableHead><TableHead className="text-right">Eşleştirilen kayıt</TableHead><TableHead className="text-right">Bir grupta</TableHead><TableHead className="pr-4 text-right">Başka tedarikçide de var</TableHead></TableRow></TableHeader>
          <TableBody>{data.bySupplier.map(row => <TableRow key={row.supplier}><TableCell className="pl-4 font-medium">{suppliers[row.supplier] ?? row.supplier}</TableCell><TableCell className="text-right tabular-nums">{number(row.items)}</TableCell><TableCell className="text-right tabular-nums">{number(row.grouped)}</TableCell><TableCell className="pr-4 text-right tabular-nums">{number(row.cross)} <span className="text-muted-foreground">(%{row.items ? Math.round(row.cross / row.items * 100) : 0})</span></TableCell></TableRow>)}</TableBody></Table>
      </AdminPanel>
      <Card className="gap-0 py-0">
        <AdminTabs label="Eşleştirme görünümü" tabs={[
          { href: query({ tab: undefined, page: undefined, scope: undefined, supplier: undefined, q: undefined }), label: "Marka çiftleri", count: data.strength.strong + data.strength.weak, current: data.tab === "pairs" },
          { href: query({ tab: "groups", page: undefined, strength: undefined }), label: "Ürün grupları", count: stats.groups, current: data.tab === "groups" },
        ]}/>
        {data.tab === "pairs" ? <>
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <AdminTabs label="Benzerlik" className="border-0 px-0" tabs={[
              { href: query({ strength: undefined, page: undefined }), label: "Güçlü benzerlik", count: data.strength.strong, current: !data.weak },
              { href: query({ strength: "weak", page: undefined }), label: "Zayıf benzerlik", count: data.strength.weak, current: data.weak },
            ]}/>
            <DecisionHelp/>
          </div>
          {pairs.length ? <div className="overflow-x-auto"><Table className="min-w-[900px] table-fixed text-xs [&_td]:py-1.5"><caption className="sr-only">İncelenecek marka çiftleri</caption>
            <TableHeader><TableRow className="bg-muted/40"><TableHead className="w-32 pl-4">Marka A</TableHead><TableHead className="w-32">Marka B</TableHead><TableHead className="w-20 text-right">Ortak no</TableHead><TableHead className="w-20 text-center" title="Ürün adı benzerliği">Benzerlik</TableHead><TableHead>Örnek (parça no · A · B)</TableHead><TableHead className="w-[13.5rem]">Karar</TableHead><TableHead className="w-10 pr-3"><span className="sr-only">Örnekler</span></TableHead></TableRow></TableHeader>
            <TableBody>{pairs.map(pair => {
              const sample = pair.samples[0];
              const sampleText = sample ? `${sample.part} · ${sample.a || "—"} · ${sample.b || "—"}` : "—";
              return <TableRow key={`${pair.brand_a}|${pair.brand_b}`}>
                <TableCell className="truncate pl-4 font-medium" title={pair.brand_a}>{pair.brand_a}</TableCell>
                <TableCell className="truncate font-medium" title={pair.brand_b}>{pair.brand_b}</TableCell>
                <TableCell className="text-right tabular-nums">{pair.shared_parts}</TableCell>
                <TableCell className="text-center">{pair.similarity ? <StatusBadge tone={pair.strong ? "success" : "neutral"}>{pair.similarity}</StatusBadge> : "—"}</TableCell>
                <TableCell className="truncate text-muted-foreground" title={sampleText}>{sample ? <><span className="font-mono text-foreground">{sample.part}</span> · {sample.a || "—"} · {sample.b || "—"}</> : "—"}</TableCell>
                <TableCell><PairDecision pair={pair} back={back}/></TableCell>
                <TableCell className="pr-3"><PairDialog pair={pair} back={back}/></TableCell>
              </TableRow>;
            })}</TableBody></Table></div> : <EmptyState title="Bu görünümde incelenecek marka çifti yok." icon={<GitCompareArrows/>}/>}
          {pager}
        </> : <>
          <form className="flex items-center gap-2 overflow-x-auto border-b p-3 [&>*]:shrink-0" action="/yonetim/urun-eslestirme">
            <input type="hidden" name="tab" value="groups"/>
            <InputGroup className="w-64"><InputGroupAddon><Search aria-hidden="true"/></InputGroupAddon><InputGroupInput name="q" aria-label="Ara" defaultValue={params.q} placeholder="Parça no veya marka" maxLength={80}/></InputGroup>
            <NativeSelect className="w-44" aria-label="Kapsam" name="scope" defaultValue={params.scope || ""}><NativeSelectOption value="">Tedarikçiler arası</NativeSelectOption><NativeSelectOption value="duplicate">Tedarikçi içi tekrar</NativeSelectOption><NativeSelectOption value="all">Tümü</NativeSelectOption></NativeSelect>
            <NativeSelect className="w-36" aria-label="Tedarikçi" name="supplier" defaultValue={params.supplier || ""}><NativeSelectOption value="">Tedarikçiler</NativeSelectOption>{Object.entries(suppliers).map(([key, label]) => <NativeSelectOption key={key} value={key}>{label}</NativeSelectOption>)}</NativeSelect>
            <Button type="submit">Filtrele</Button><ButtonLink variant="ghost" href={query({ tab: "groups", scope: undefined, supplier: undefined, q: undefined, page: undefined })}>Temizle</ButtonLink>
          </form>
          {data.groups.length ? <div className="overflow-x-auto"><Table className="min-w-[900px] table-fixed text-xs [&_td]:py-1.5"><caption className="sr-only">Aynı ürün grupları</caption>
            <TableHeader><TableRow className="bg-muted/40"><TableHead className="w-32 pl-4">Parça no</TableHead><TableHead className="w-28">Marka</TableHead><TableHead className="w-36">Tedarikçiler</TableHead><TableHead className="w-16 text-right">Kayıt</TableHead><TableHead>Ürün adı</TableHead><TableHead className="w-20 text-center">Stok</TableHead><TableHead className="w-28 text-right">Mağaza (₺)</TableHead><TableHead className="w-10 pr-3"><span className="sr-only">Kayıtlar</span></TableHead></TableRow></TableHeader>
            <TableBody>{data.groups.map(group => {
              const name = group.items.find(item => item.name)?.name ?? null;
              const inStock = group.items.filter(item => item.in_stock).length;
              const prices = group.items.map(item => item.sale_price_kurus).filter((value): value is number => Boolean(value));
              return <TableRow key={`${group.brand}|${group.part_number}`}>
                <TableCell className="truncate pl-4 font-mono font-medium" title={group.part_number}>{group.part_number}</TableCell>
                <TableCell className="truncate text-muted-foreground" title={group.brand}>{group.brand}</TableCell>
                <TableCell className="truncate">{group.suppliers.map(s => suppliers[s] ?? s).join(" · ")}</TableCell>
                <TableCell className="text-right tabular-nums">{group.members}</TableCell>
                <TableCell className="truncate font-medium" title={name ?? ""}>{name || "—"}</TableCell>
                <TableCell className="text-center tabular-nums"><StockLabel stock={inStock > 0}/><span className="text-muted-foreground"> {inStock}/{group.items.length}</span></TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{prices.length ? money(Math.min(...prices)) : "—"}</TableCell>
                <TableCell className="pr-3"><GroupDialog title={`${group.brand} ${group.part_number}`} description={`${group.members} kayıt · ${group.suppliers.map(s => suppliers[s] ?? s).join(", ")} · kaynak fiyatlar dönüştürülmeden gösterilir`}
                  members={group.items.map(item => ({ id: item.supplier_item_id, supplier: suppliers[item.supplier] ?? item.supplier, code: item.code, brand: item.source_brand, name: item.name, cost: cost(item), stock: item.in_stock, sale: sale(item) }))}/></TableCell>
              </TableRow>;
            })}</TableBody></Table></div> : <EmptyState title="Filtrelere uygun grup bulunamadı." icon={<SearchX/>}/>}
          {pager}
        </>}
      </Card>
    </>}
  </AdminPage>;
}
