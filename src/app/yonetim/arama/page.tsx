import Link from "next/link";
import { CircleAlert, CircleCheck, ExternalLink, Info, Plus, Search, SearchX, Trash2 } from "lucide-react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { requireAdmin } from "@/modules/auth/session";
import { loadCustomSynonyms, loadSearchStats, loadSearchTotals, searchStatsLimit, searchStatsPeriods, type SearchStatsPeriod, type SearchStatsTab } from "@/modules/search/analytics";
import { addSynonymGroupAction, deleteSynonymGroupAction } from "@/modules/search/analytics-actions";
import { builtInSynonymGroups } from "@/modules/search/query";
import { formatDateTime, formatNumber } from "@/modules/admin/format";
import { searchPath } from "@/modules/seo/paths";
import { StatusBadge } from "@/components/admin/status-badge";
import { SubmitButton } from "@/components/admin/submit-button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const metadata = { title: "Arama" };
type Tab = SearchStatsTab | "synonyms";
const tabs: { key: Tab; label: string }[] = [
  { key: "zero", label: "Sonuçsuz aramalar" }, { key: "top", label: "En çok arananlar" }, { key: "synonyms", label: "Eş anlamlılar" },
];
const href = (tab: Tab, days: SearchStatsPeriod, extra: Record<string, string> = {}) =>
  `/yonetim/arama?${new URLSearchParams({ ...(tab === "zero" ? {} : { tab }), ...(days === 30 ? {} : { days: String(days) }), ...extra })}`;

// Storefront search analytics and admin synonym groups (#822).
export default async function SearchAnalytics({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const params = normalizeSearchParams(await searchParams);
  const tab: Tab = params.tab === "top" || params.tab === "synonyms" ? params.tab : "zero";
  const days = searchStatsPeriods.find(period => String(period) === params.days) ?? 30;
  const [totals, rows, custom] = await Promise.all([
    loadSearchTotals(days),
    tab === "synonyms" ? [] : loadSearchStats(tab, days),
    tab === "synonyms" ? loadCustomSynonyms() : [],
  ]);
  const zeroShare = totals.searches ? (totals.zero_results / totals.searches) * 100 : 0;

  return <div className="flex flex-col gap-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 max-w-3xl flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Arama</h1>
        <p className="text-muted-foreground">Mağazada yapılan aramalar (yalnız sorgu metni ve sayılar tutulur; kişisel veri yok, 180 gün saklanır). Sonuçsuz kalan sorgular için eş anlamlı ekleyerek aynı parçanın farklı yazılışlarını birbirine bağla.</p>
      </div>
      <ButtonGroup aria-label="Dönem">
        {searchStatsPeriods.map(period => <Button key={period} size="sm" variant={period === days ? "secondary" : "outline"} nativeButton={false}
          render={<Link href={href(tab, period)} scroll={false} aria-current={period === days ? "true" : undefined}/>}>Son {period} gün</Button>)}
      </ButtonGroup>
    </div>

    {params.saved && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>{params.saved === "deleted" ? "Eş anlamlı grubu silindi." : "Eş anlamlı grubu eklendi; aramalar birkaç saniye içinde yeni grubu kullanır."}</AlertDescription></Alert>}
    {params.error && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{params.error === "words" ? "En az iki farklı yazılış girin (virgülle ayırarak)." : "Grup silinemedi. Listeyi yenileyin."}</AlertDescription></Alert>}

    <section className="grid gap-4 sm:grid-cols-3" aria-label="Özet">
      <Card><CardHeader>
        <CardDescription>Arama · son {days} gün</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">{formatNumber(totals.searches)}</CardTitle>
      </CardHeader></Card>
      <Card><CardHeader>
        <CardDescription>Farklı sorgu</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">{formatNumber(totals.queries)}</CardTitle>
      </CardHeader></Card>
      <Card><CardHeader>
        <CardDescription>Sonuçsuz arama oranı</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">%{zeroShare.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}</CardTitle>
      </CardHeader></Card>
    </section>

    <Tabs value={tab}><ScrollArea className="pb-2">
      <TabsList variant="line" aria-label="Arama görünümleri">
        {tabs.map(({ key, label }) => <TabsTrigger key={key} value={key} nativeButton={false} render={<Link href={href(key, days)} scroll={false}/>}>{label}</TabsTrigger>)}
      </TabsList>
      <ScrollBar orientation="horizontal"/>
    </ScrollArea></Tabs>

    {tab === "synonyms" ? <>
      <Card>
        <CardHeader>
          <CardTitle>Eş anlamlı grubu ekle</CardTitle>
          <CardDescription>Gruptaki her yazılış diğerlerini de bulur. Bir yazılış en çok dört kelimelik bir ifade olabilir (&quot;soğutma sıvısı&quot;); Türkçe ekler ve harfler aramadaki gibi yok sayılır.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={addSynonymGroupAction} className="flex flex-col gap-4 md:flex-row md:items-end">
            <Field className="md:flex-1">
              <FieldLabel htmlFor="synonym-words">Yazılışlar</FieldLabel>
              <Input id="synonym-words" name="words" defaultValue={params.words ?? ""} placeholder="ör. antifriz, soğutma sıvısı" maxLength={500} required/>
              <FieldDescription>Virgülle ayırın, en az iki yazılış.</FieldDescription>
            </Field>
            <SubmitButton icon={<Plus data-icon="inline-start" aria-hidden="true"/>}>Ekle</SubmitButton>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Panelden eklenen gruplar</CardTitle>
          <CardDescription>{formatNumber(custom.length)} grup</CardDescription>
        </CardHeader>
        <CardContent>
          {custom.length ? <Table>
            <TableHeader><TableRow><TableHead>Yazılışlar</TableHead><TableHead>Ekleyen</TableHead><TableHead>Tarih</TableHead><TableHead className="text-right">İşlem</TableHead></TableRow></TableHeader>
            <TableBody>{custom.map(group => <TableRow key={group.id}>
              <TableCell className="whitespace-normal"><div className="flex flex-wrap gap-1">{group.words.map(word => <Badge key={word} variant="secondary">{word}</Badge>)}</div></TableCell>
              <TableCell>{group.created_by_name ?? "—"}</TableCell>
              <TableCell className="tabular-nums" value={new Date(group.created_at).toISOString()}>{formatDateTime(group.created_at, { year: true })}</TableCell>
              <TableCell><div className="flex justify-end">
                <form action={deleteSynonymGroupAction}>
                  <input type="hidden" name="id" value={group.id}/>
                  <SubmitButton variant="ghost" icon={<Trash2 data-icon="inline-start" aria-hidden="true"/>} aria-label={`${group.words.join(", ")} grubunu sil`}>Sil</SubmitButton>
                </form>
              </div></TableCell>
            </TableRow>)}</TableBody>
          </Table> : <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon"><Search/></EmptyMedia>
              <EmptyTitle>Henüz grup eklenmedi</EmptyTitle>
              <EmptyDescription>Sonuçsuz aramalar sekmesindeki bir sorgudan &quot;Eş anlamlı ekle&quot; ile başlayabilirsin.</EmptyDescription>
            </EmptyHeader>
          </Empty>}
        </CardContent>
      </Card>

      <Card size="sm" className="py-0"><CardContent><Accordion><AccordionItem value="built-in">
        <AccordionTrigger>Yerleşik gruplar ({formatNumber(builtInSynonymGroups.length)})</AccordionTrigger>
        <AccordionContent>
          <p className="mb-3 text-muted-foreground">Kodla gelen gruplar; buradan değiştirilemez.</p>
          <div className="flex flex-col gap-2">{builtInSynonymGroups.map(group => <div key={group.join("|")} className="flex flex-wrap gap-1">
            {group.map(word => <Badge key={word} variant="outline">{word}</Badge>)}
          </div>)}</div>
        </AccordionContent>
      </AccordionItem></Accordion></CardContent></Card>
    </> : <Card>
      <CardContent>
        {tab === "zero" && rows.length > 0 && <Alert variant="info" className="mb-4"><Info aria-hidden="true"/><AlertDescription>Yalnız son aramasında hâlâ sonuç bulunamayan sorgular listelenir. Bir eş anlamlı eklendikten sonra sorgu yeniden aranınca listeden düşer.</AlertDescription></Alert>}
        {rows.length ? <Table>
          <TableHeader><TableRow>
            <TableHead>Sorgu</TableHead><TableHead className="text-right">Arama</TableHead>
            {tab === "top" && <TableHead className="text-right">Son sonuç</TableHead>}
            <TableHead>Durum</TableHead><TableHead>Son arama</TableHead><TableHead className="text-right">İşlem</TableHead>
          </TableRow></TableHeader>
          <TableBody>{rows.map(row => <TableRow key={`${row.mode}|${row.query}`}>
            <TableCell className="min-w-48 whitespace-normal">
              <span className="font-medium">{row.query}</span>
              {row.mode === "code" && <span className="text-muted-foreground"> · kod araması</span>}
            </TableCell>
            <TableCell className="text-right tabular-nums" value={String(row.searches)}>{formatNumber(row.searches)}</TableCell>
            {tab === "top" && <TableCell className="text-right tabular-nums" value={String(row.last_total)}>{formatNumber(row.last_total)}</TableCell>}
            <TableCell>
              {row.last_total === 0 ? <StatusBadge tone="error" icon={SearchX}>Sonuç yok</StatusBadge>
                : row.corrected_query ? <StatusBadge tone="warning" title={`"${row.corrected_query}" olarak düzeltildi`}>Düzeltmeyle: {row.corrected_query}</StatusBadge>
                : <StatusBadge tone="success">Sonuç var</StatusBadge>}
            </TableCell>
            <TableCell className="tabular-nums" value={new Date(row.last_searched_at).toISOString()}>{formatDateTime(row.last_searched_at, { year: true })}</TableCell>
            <TableCell><div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" nativeButton={false} render={<Link href={searchPath({ q: row.query, ...(row.mode === "code" ? { searchBy: "code" as const } : {}) })} target="_blank"/>}>
                <ExternalLink data-icon="inline-start" aria-hidden="true"/>Mağazada ara
              </Button>
              {row.mode === "all" && <Button size="sm" variant="outline" nativeButton={false} render={<Link href={href("synonyms", days, { words: `${row.query}, ` })}/>}>
                <Plus data-icon="inline-start" aria-hidden="true"/>Eş anlamlı ekle
              </Button>}
            </div></TableCell>
          </TableRow>)}</TableBody>
        </Table> : <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">{tab === "zero" ? <SearchX/> : <Search/>}</EmptyMedia>
            <EmptyTitle>{tab === "zero" ? "Sonuçsuz arama yok" : "Bu dönemde arama yok"}</EmptyTitle>
            <EmptyDescription>Mağazadaki aramalar ilk sonuç sayfası açıldığında sayılır.</EmptyDescription>
          </EmptyHeader>
        </Empty>}
        {rows.length >= searchStatsLimit && <p className="mt-4 text-muted-foreground">İlk {formatNumber(searchStatsLimit)} sorgu gösteriliyor.</p>}
      </CardContent>
    </Card>}
  </div>;
}
