import { Fragment } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, Download, FileSpreadsheet, History, Info, PackageSearch, TriangleAlert } from "lucide-react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { SupplierTabs } from "@/components/admin/supplier-tabs";
import { SupplierPartTable } from "@/components/admin/supplier-part-table";
import { manualPartTableProps } from "@/components/admin/supplier-part-table-data";
import { SupplierBrowser } from "@/components/admin/supplier-browser";
import { ManualProductFilters } from "@/components/admin/manual-product-filters";
import { ManualSubmitButton } from "@/components/admin/manual-submit-button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminManualData, type ManualUpload } from "@/modules/admin/manual";
import { manualColumns, type ManualIssue } from "@/modules/suppliers/manual-template";
import { confirmManualDraft, discardManualDraft, uploadManualList } from "./actions";

const base = "/yonetim/tedarikciler/manuel";
const number = (value: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(value);
const date = (value: Date) => value.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });
const errors: Record<string, string> = {
  file: "Bir .xlsx dosyası seçin (en fazla 8 MB).",
  unreadable: "Dosya okunamadı. Numbers veya Excel'den .xlsx olarak dışa aktarıp yeniden deneyin.",
  list: "Mevcut bir liste seçin ya da yeni liste için bir ad yazın.",
  invalid: "Taslakta hata var; dosyayı düzeltip yeniden yükleyin.",
  decided: "Bu taslak zaten içe aktarıldı ya da vazgeçildi.",
  "not-found": "Taslak bulunamadı.",
  busy: "Başka bir manuel liste işlemi sürüyor. Biraz sonra yeniden deneyin.",
  input: "İstek eksik veya hatalı.",
};
const uploadStatus = (status: ManualUpload["status"]) => status === "imported" ? <Badge variant="success"><CircleCheck data-icon="inline-start" aria-hidden="true"/>İçe aktarıldı</Badge>
  : status === "draft" ? <Badge variant="info"><Info data-icon="inline-start" aria-hidden="true"/>Onay bekliyor</Badge> : <Badge variant="outline">Vazgeçildi</Badge>;
const fieldLabel = (field: ManualIssue["field"]) => manualColumns.find(column => column.key === field)?.header ?? "—";
// Many rows share one warning ("Fiyat yok…"); the summary groups them by field and message, without the row's own value.
const issueKind = (issue: ManualIssue) => `${issue.level}|${issue.field ?? ""}|${issue.message.replace(/:.*$/, "")}`;

export default async function ManualAdmin({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = normalizeSearchParams(await searchParams);
  const { lists, list, uploads, draft, listCategories, products, categoryNames } = await adminManualData(params);
  const pageUrl = (target: number) => {
    const query = new URLSearchParams({ page: String(target) });
    for (const key of ["liste", "q", "category", "stock", "quality", "presence", "sort", "dir"] as const) if (params[key]) query.set(key, params[key]!);
    return `${base}?${query}`;
  };
  const pages = products?.pages ?? 1, page = products?.page ?? 1;
  const pageNumbers = Array.from(new Set([1, ...Array.from({ length: 5 }, (_, i) => Math.max(1, Math.min(page - 2, pages - 4)) + i), pages])).filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
  const facts: [string, string, string][] = list ? [
    ["Listedeki ürün", number(list.present), list.list_name],
    ["Fiyatı eksik", number(list.missing_prices), "Satışa kapalı listelenir"],
    ["Ambalajı eksik", number(list.missing_packages), "Ürün sayfasından girilebilir"],
    ["Son içe aktarma", list.last_import ? date(list.last_import) : "Henüz yok", `${number(lists.length)} liste`],
  ] : [];
  const grouped = draft ? [...draft.report.issues.reduce((groups, issue) => {
    const key = issueKind(issue);
    const group = groups.get(key) ?? { issue, count: 0, codes: [] as string[] };
    group.count++;
    if (issue.code && group.codes.length < 5) group.codes.push(issue.code);
    return groups.set(key, group);
  }, new Map<string, { issue: ManualIssue; count: number; codes: string[] }>()).values()].sort((a, b) => Number(a.issue.level === "warning") - Number(b.issue.level === "warning") || b.count - a.count) : [];
  const detailed = draft ? [...draft.report.issues].sort((a, b) => Number(a.level === "warning") - Number(b.level === "warning")).slice(0, 500) : [];
  return <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <Breadcrumb><BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink render={<Link href="/yonetim"/>}>Yönetim</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator/>
        <BreadcrumbItem><BreadcrumbLink render={<Link href="/yonetim/tedarikciler"/>}>Tedarikçiler</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator/>
        <BreadcrumbItem><BreadcrumbPage>Manuel yükleme</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList></Breadcrumb>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Manuel yükleme</h1>
          <p className="text-muted-foreground">Şablondaki .xlsx listeleri bir tedarikçi listesi gibi içe aktarılır: önce kontrol edilir, onaydan sonra mağazaya yansır.</p>
        </div>
        <Button variant="outline" nativeButton={false} render={<a href={`${base}/sablon`} download/>}><Download data-icon="inline-start" aria-hidden="true"/>Boş şablonu indir</Button>
      </div>
    </div>
    {params.uploaded === "1" && <Alert variant="info" role="status"><Info aria-hidden="true"/><AlertDescription>Dosya okundu. Önizlemeyi kontrol edip içe aktarın; onaylanana kadar hiçbir ürün değişmez.</AlertDescription></Alert>}
    {params.imported === "1" && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertTitle>Liste içe aktarıldı</AlertTitle><AlertDescription>Ürünler mağazada listelenir; kategori sayfaları 10 dakika içinde güncellenir. Mevcut ürünlerle eşleşmeleri için <Link className="underline" href="/yonetim/urun-eslestirme">Ürün eşleştirme</Link> sayfasında eşleştirmeyi yenileyin.</AlertDescription></Alert>}
    {params.discarded === "1" && <Alert role="status"><Info aria-hidden="true"/><AlertDescription>Taslaktan vazgeçildi; hiçbir ürün değişmedi.</AlertDescription></Alert>}
    {params.error && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{errors[params.error] || "İşlem tamamlanamadı."}{params.detail && ` (${params.detail})`}</AlertDescription></Alert>}
    {list && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" role="region" aria-label="Liste özeti">
      {facts.map(([label, value, note]) => <Card key={label} size="sm">
        <CardHeader><CardDescription>{label}</CardDescription><CardTitle className="tabular-nums">{value}</CardTitle></CardHeader>
        <CardContent className="text-muted-foreground">{note}</CardContent>
      </Card>)}
    </div>}
    <SupplierTabs label="Manuel yükleme" transferLabel="Yükleme ve kontrol" key={[params.taslak, params.error, params.imported].join("|")}
      initialTab={draft || params.error || !list ? "transfer" : "products"} transfer={<div className="flex flex-col gap-4">
      {draft && <Card>
        <CardHeader>
          <CardTitle><h2>Önizleme · {draft.file_name}</h2></CardTitle>
          <CardDescription>{draft.list_name} listesi · {date(draft.created_at)}{draft.uploader && ` · ${draft.uploader}`}</CardDescription>
          <CardAction>{uploadStatus(draft.status)}</CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
            {([["Ürün", draft.report.products], ["Yeni", draft.report.added], ["Güncellenecek", draft.report.updated], ["Listeden çıkacak", draft.report.removed], ["Hata", draft.report.errors], ["Uyarı", draft.report.warnings]] as const).map(([label, value]) =>
              <Card key={label} size="sm"><CardHeader><CardDescription>{label}</CardDescription><CardTitle className={label === "Hata" && value ? "text-destructive tabular-nums" : "tabular-nums"}>{number(value)}</CardTitle></CardHeader></Card>)}
          </div>
          <p className="text-muted-foreground">Sayfalar: {draft.report.sheets.map(sheet => `${sheet.name} (${number(sheet.rows)})`).join(" · ") || "—"}</p>
          {draft.report.errors > 0 && <Alert variant="destructive"><CircleAlert aria-hidden="true"/><AlertTitle>{number(draft.report.errors)} hata var</AlertTitle><AlertDescription>Hatalı satırlar içe aktarılamaz. Dosyayı düzeltip yeniden yükleyin.</AlertDescription></Alert>}
          {draft.report.removed > 0 && <Alert variant="warning"><TriangleAlert aria-hidden="true"/><AlertTitle>{number(draft.report.removed)} ürün bu dosyada yok</AlertTitle><AlertDescription>Onaylarsanız “son yüklemede yok” olarak işaretlenir ve mağazadan kalkar; bir sonraki yüklemede de yoksa pasife alınır. {draft.report.removedCodes.slice(0, 20).join(", ")}{draft.report.removed > 20 && "…"}</AlertDescription></Alert>}
          {grouped.length > 0 && <Table><caption className="sr-only">Kontrol sonuçlarının özeti</caption>
            <TableHeader><TableRow><TableHead>Seviye</TableHead><TableHead>Alan</TableHead><TableHead>Bulgu</TableHead><TableHead className="text-right">Satır</TableHead><TableHead>Örnek kodlar</TableHead></TableRow></TableHeader>
            <TableBody>{grouped.map(({ issue, count, codes }) => <TableRow key={issueKind(issue)}>
              <TableCell>{issue.level === "error" ? <Badge variant="destructive"><CircleAlert data-icon="inline-start" aria-hidden="true"/>Hata</Badge> : <Badge variant="warning"><TriangleAlert data-icon="inline-start" aria-hidden="true"/>Uyarı</Badge>}</TableCell>
              <TableCell>{fieldLabel(issue.field)}</TableCell>
              <TableCell className="whitespace-normal">{count === 1 ? issue.message : issue.message.replace(/:.*$/, "")}</TableCell>
              <TableCell className="text-right tabular-nums">{number(count)}</TableCell>
              <TableCell className="whitespace-normal font-mono text-muted-foreground">{codes.join(", ")}{count > codes.length && "…"}</TableCell>
            </TableRow>)}</TableBody>
          </Table>}
          {detailed.length > 0 && <Accordion className="rounded-lg border"><AccordionItem value="rows" className="px-4">
            <AccordionTrigger>Satır satır bulgular ({number(draft.report.issues.length)}{draft.report.issues.length > detailed.length ? `, ilk ${number(detailed.length)} gösteriliyor` : ""})</AccordionTrigger>
            <AccordionContent><Table><caption className="sr-only">Satır satır kontrol sonuçları</caption>
              <TableHeader><TableRow><TableHead>Seviye</TableHead><TableHead>Sayfa</TableHead><TableHead className="text-right">Satır</TableHead><TableHead>Kod</TableHead><TableHead>Alan</TableHead><TableHead>Bulgu</TableHead></TableRow></TableHeader>
              <TableBody>{detailed.map((issue, index) => <TableRow key={index}>
                <TableCell>{issue.level === "error" ? "Hata" : "Uyarı"}</TableCell><TableCell>{issue.sheet || "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{issue.row ?? "—"}</TableCell><TableCell className="font-mono">{issue.code ?? "—"}</TableCell>
                <TableCell>{fieldLabel(issue.field)}</TableCell><TableCell className="whitespace-normal">{issue.message}</TableCell>
              </TableRow>)}</TableBody>
            </Table></AccordionContent>
          </AccordionItem></Accordion>}
          {draft.rows.length > 0 && <Table><caption className="sr-only">İlk satırlar</caption>
            <TableHeader><TableRow><TableHead>Kod</TableHead><TableHead>Ürün adı</TableHead><TableHead>Marka</TableHead><TableHead>Kategori</TableHead><TableHead>Ambalaj</TableHead><TableHead>Viskozite</TableHead><TableHead className="text-right">Fiyat</TableHead><TableHead className="text-right">Stok</TableHead></TableRow></TableHeader>
            <TableBody>{draft.rows.slice(0, 10).map(row => <TableRow key={row.code}>
              <TableCell className="font-mono">{row.code}</TableCell><TableCell className="max-w-96 truncate" title={row.name}>{row.name}</TableCell><TableCell>{row.brand}</TableCell>
              <TableCell>{categoryNames.get(row.categoryId)}</TableCell><TableCell>{row.package ?? <span className="text-warning">Eksik</span>}</TableCell><TableCell>{row.viscosity ?? "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{row.price === null ? "—" : number(row.price)}</TableCell><TableCell className="text-right tabular-nums">{row.stock === null ? "—" : number(row.stock)}</TableCell>
            </TableRow>)}</TableBody>
          </Table>}
          {draft.rows.length > 10 && <p className="text-muted-foreground">İlk 10 satır gösteriliyor; toplam {number(draft.rows.length)} ürün.</p>}
        </CardContent>
        {draft.status === "draft" && <CardFooter className="flex-wrap gap-2">
          <form action={confirmManualDraft}><input type="hidden" name="id" value={draft.id}/><input type="hidden" name="list" value={draft.list_group}/>
            <ManualSubmitButton icon="check" label={`${number(draft.report.products)} ürünü içe aktar`} pendingLabel="İçe aktarılıyor, resimler indiriliyor…" disabled={draft.report.errors > 0 || !draft.rows.length}/></form>
          <form action={discardManualDraft}><input type="hidden" name="id" value={draft.id}/><input type="hidden" name="list" value={draft.list_group}/>
            <Button type="submit" variant="ghost">Vazgeç</Button></form>
        </CardFooter>}
      </Card>}
      <Card>
        <CardHeader><CardTitle><h2>Dosya yükle</h2></CardTitle><CardDescription>Dosya önce kontrol edilir; hiçbir ürün onayınız olmadan değişmez.</CardDescription><CardAction><Badge variant="outline"><FileSpreadsheet data-icon="inline-start" aria-hidden="true"/>.xlsx</Badge></CardAction></CardHeader>
        <CardContent>
          <form action={uploadManualList} className="flex flex-col gap-4">
            <FieldGroup className="grid gap-4 md:grid-cols-3">
              <Field><FieldLabel htmlFor="manual-list">Liste</FieldLabel>
                <NativeSelect id="manual-list" name="list" defaultValue={list?.list_group ?? "new"}>
                  {lists.map(entry => <NativeSelectOption key={entry.list_group} value={entry.list_group}>{entry.list_name} ({number(entry.present)} ürün)</NativeSelectOption>)}
                  <NativeSelectOption value="new">Yeni liste…</NativeSelectOption>
                </NativeSelect>
                <FieldDescription>Aynı listeyi yeniden yüklemek ürünleri günceller.</FieldDescription></Field>
              <Field><FieldLabel htmlFor="manual-new-list">Yeni liste adı</FieldLabel><Input id="manual-new-list" name="new_list" maxLength={120} placeholder="Örn. Madeni yağlar"/>
                <FieldDescription>Yalnız “Yeni liste…” seçiliyse kullanılır.</FieldDescription></Field>
              <Field><FieldLabel htmlFor="manual-file">Dosya</FieldLabel><Input id="manual-file" name="file" type="file" required accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>
                <FieldDescription>Numbers dosyasını Dosya › Dışa Aktar › Excel ile .xlsx yapın.</FieldDescription></Field>
            </FieldGroup>
            <div><ManualSubmitButton label="Yükle ve kontrol et" pendingLabel="Dosya kontrol ediliyor…"/></div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle><h2>Şablon</h2></CardTitle><CardDescription>Sütunlar başlık adıyla bulunur; sıraları ve sayfa adları serbesttir. Kategori, şablondaki Kategoriler sayfasından seçilir.</CardDescription></CardHeader>
        <CardContent><Table><caption className="sr-only">Şablon sütunları</caption>
          <TableHeader><TableRow><TableHead>Sütun</TableHead><TableHead>Durum</TableHead><TableHead>Açıklama</TableHead></TableRow></TableHeader>
          <TableBody>{manualColumns.map(column => <TableRow key={column.key}>
            <TableCell className="font-medium">{column.header}</TableCell>
            <TableCell>{column.required ? <Badge variant="info">Zorunlu</Badge> : <Badge variant="outline">İsteğe bağlı</Badge>}</TableCell>
            <TableCell className="whitespace-normal text-muted-foreground">{column.note}</TableCell>
          </TableRow>)}</TableBody>
        </Table></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle><h2>Yükleme geçmişi</h2></CardTitle><CardDescription>Son {uploads.length} yükleme</CardDescription></CardHeader>
        <CardContent>
          {uploads.length ? <Table><caption className="sr-only">Manuel liste yükleme geçmişi</caption>
            <TableHeader><TableRow><TableHead>Tarih</TableHead><TableHead>Liste</TableHead><TableHead>Dosya</TableHead><TableHead className="text-right">Ürün</TableHead><TableHead>Kontrol</TableHead><TableHead>Durum</TableHead><TableHead>Sonuç</TableHead></TableRow></TableHeader>
            <TableBody>{uploads.map(upload => <TableRow key={upload.id} className="align-top">
              <TableCell className="tabular-nums"><Link className="underline-offset-4 hover:underline" href={`${base}?${new URLSearchParams({ liste: upload.list_group, taslak: upload.id })}`}>{date(upload.created_at)}</Link>{upload.uploader && <span className="block text-muted-foreground">{upload.uploader}</span>}</TableCell>
              <TableCell>{upload.list_name}</TableCell>
              <TableCell className="max-w-56 truncate" title={upload.file_name}>{upload.file_name}</TableCell>
              <TableCell className="text-right tabular-nums">{number(upload.report.products)}</TableCell>
              <TableCell className="tabular-nums">{upload.report.errors ? <span className="text-destructive">{number(upload.report.errors)} hata</span> : "Hata yok"} · {number(upload.report.warnings)} uyarı</TableCell>
              <TableCell>{uploadStatus(upload.status)}</TableCell>
              <TableCell className="whitespace-normal">{upload.stats ? <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-muted-foreground tabular-nums">{([["added", "yeni"], ["changed", "değişen"], ["unchanged", "aynı"], ["missing", "listede yok"], ["inactive", "pasif"], ["restored", "geri gelen"]] as const).map(([key, label]) => <span key={key}><b className="font-medium text-foreground">{number(upload.stats![key] ?? 0)}</b> {label}</span>)}</div> : "—"}
                {upload.quality?.imagesStored !== undefined && <span className="block text-muted-foreground tabular-nums">{number(upload.quality.imagesStored)} resim kaydedildi{upload.quality.imagesFailed ? ` · ${number(upload.quality.imagesFailed)} indirilemedi` : ""}</span>}</TableCell>
            </TableRow>)}</TableBody>
          </Table> : <Empty><EmptyHeader><EmptyMedia variant="icon"><History/></EmptyMedia><EmptyTitle>Henüz yükleme yok</EmptyTitle></EmptyHeader></Empty>}
        </CardContent>
      </Card>
    </div>} products={
    <SupplierBrowser><Card>
      {list && <CardHeader className="border-b">
        <ManualProductFilters key={[params.liste, params.q, params.category, params.stock, params.presence, params.quality].join("|")} params={params} list={list.list_group}
          lists={lists.map(entry => ({ value: entry.list_group, label: entry.list_name }))} categories={listCategories}/>
      </CardHeader>}
      {!list || !products ? <CardContent><Empty><EmptyHeader><EmptyMedia variant="icon"><PackageSearch/></EmptyMedia><EmptyTitle>Henüz manuel liste yok.</EmptyTitle><EmptyDescription>Yükleme sekmesinden şablondaki bir dosyayı yükleyin.</EmptyDescription></EmptyHeader></Empty></CardContent> : <>
      <CardContent className="flex flex-col gap-3 group-data-loading/browser:pointer-events-none group-data-loading/browser:opacity-50">
        <div className="flex flex-wrap justify-between gap-2 text-muted-foreground tabular-nums"><span><strong className="text-foreground">{number(products.total)}</strong> ürün · {params.category || "Tüm kategoriler"}</span><span>NF: KDV hariç alış · Satış: KDV dahil</span></div>
        <SupplierPartTable {...manualPartTableProps(products.items, { categories: listCategories })}/>
      </CardContent>
      <CardFooter className="flex-wrap justify-between gap-3">
        <span className="text-muted-foreground tabular-nums">Sayfa {number(page)} / {number(pages)}</span>
        <Pagination className="mx-0 w-auto" aria-label="Ürün sayfaları"><PaginationContent>
          <PaginationItem><PaginationPrevious text="Önceki" aria-label="Önceki sayfa" href={page > 1 ? pageUrl(page - 1) : undefined} aria-disabled={page <= 1 || undefined}/></PaginationItem>
          {pageNumbers.map((n, i, ns) => <Fragment key={n}>{i > 0 && n - ns[i - 1] > 1 && <PaginationItem><PaginationEllipsis/></PaginationItem>}<PaginationItem><PaginationLink href={pageUrl(n)} isActive={n === page}>{n}</PaginationLink></PaginationItem></Fragment>)}
          <PaginationItem><PaginationNext text="Sonraki" aria-label="Sonraki sayfa" href={page < pages ? pageUrl(page + 1) : undefined} aria-disabled={page >= pages || undefined}/></PaginationItem>
        </PaginationContent></Pagination>
        <form action={base} className="flex items-center gap-2">{Object.entries(params).filter(([key]) => ["liste", "q", "category", "stock", "quality", "presence"].includes(key)).map(([key, value]) => <input key={key} type="hidden" name={key} value={value || ""}/>)}<Label htmlFor="page-jump">Sayfaya git</Label><Input id="page-jump" className="w-20" type="number" name="page" min={1} max={pages} defaultValue={page}/><Button type="submit" variant="outline">Git</Button></form>
      </CardFooter>
      </>}
    </Card></SupplierBrowser>
    }/>
  </div>;
}
