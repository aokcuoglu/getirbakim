import Link from "next/link";
import { CircleAlert, CircleCheck, Download, FileSpreadsheet, History, Info, PackageSearch, TriangleAlert, Upload } from "lucide-react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { SupplierPage } from "@/components/admin/supplier-page";
import { SupplierPagination } from "@/components/admin/supplier-pagination";
import { StatusBadge } from "@/components/admin/status-badge";
import { SupplierPartTable, supplierPartEmpty } from "@/components/admin/supplier-part-table";
import { costNotes, manualPartTableProps } from "@/components/admin/supplier-part-table-data";
import { formatDate, formatNumber } from "@/modules/admin/format";
import { SupplierBrowser } from "@/components/admin/supplier-browser";
import { ManualProductFilters } from "@/components/admin/manual-product-filters";
import { SubmitButton } from "@/components/admin/submit-button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminManualData, type ManualUpload } from "@/modules/admin/manual";
import { manualColumns, type ManualIssue } from "@/modules/suppliers/manual-template";
import { ManualBulkPreview } from "@/components/admin/manual-bulk-preview";
import { confirmManualDraft, discardManualDraft, uploadManualBulk, uploadManualList } from "./actions";

const base = "/yonetim/tedarikciler/manuel";
const number = formatNumber;
const date = (value: Date) => formatDate(value);
// The row-by-row findings list stops here; the summary table above still counts every finding.
const issueRowLimit = 500;
const filterKeys = ["liste", "q", "category", "stock", "quality", "presence"] as const;
const errors: Record<string, string> = {
  file: "Bir .xlsx dosyası seçin (en fazla 8 MB).",
  "csv-file": "Bir .csv dosyası seçin (en fazla 2 MB).",
  locked: "Ürünler şu anda başka bir işlemde (ör. ürün eşleştirme) güncelleniyor; hiçbir şey değişmedi. Bir iki dakika sonra yeniden deneyin.",
  unreadable: "Dosya okunamadı. Numbers veya Excel'den .xlsx olarak dışa aktarıp yeniden deneyin.",
  list: "Mevcut bir liste seçin ya da yeni liste için bir ad yazın.",
  invalid: "Taslakta hata var; dosyayı düzeltip yeniden yükleyin.",
  decided: "Bu taslak zaten içe aktarıldı ya da vazgeçildi.",
  "not-found": "Taslak bulunamadı.",
  busy: "Başka bir manuel liste işlemi sürüyor. Biraz sonra yeniden deneyin.",
  input: "İstek eksik veya hatalı.",
};
const uploadStatus = (status: ManualUpload["status"]) => status === "imported" ? <StatusBadge tone="success">İçe aktarıldı</StatusBadge>
  : status === "draft" ? <StatusBadge tone="info">Onay bekliyor</StatusBadge> : <StatusBadge tone="neutral">Vazgeçildi</StatusBadge>;
const fieldLabel = (field: ManualIssue["field"]) => manualColumns.find(column => column.key === field)?.header ?? "—";
// Many rows share one warning ("Fiyat yok…"); the summary groups them by field and message, without the row's own value.
const issueKind = (issue: ManualIssue) => `${issue.level}|${issue.field ?? ""}|${issue.message.replace(/:.*$/, "")}`;

export default async function ManualAdmin({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = normalizeSearchParams(await searchParams);
  const { lists, list, uploads, draft, listCategories, products, categoryNames } = await adminManualData(params);
  const pages = products?.pages ?? 1, page = products?.page ?? 1;
  // The CSV download follows the product tab's filters.
  const csvQuery = new URLSearchParams(filterKeys.flatMap(key => params[key] ? [[key, params[key]!]] : []));
  if (list) csvQuery.set("liste", list.list_group);
  const csvHref = `${base}/csv?${csvQuery}`;
  const filtered = filterKeys.some(key => key !== "liste" && params[key]);
  // The upload card offers the whole list; the product tab's button follows its filters.
  const listCsvHref = list ? `${base}/csv?${new URLSearchParams({ liste: list.list_group })}` : csvHref;
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
  const detailed = draft ? [...draft.report.issues].sort((a, b) => Number(a.level === "warning") - Number(b.level === "warning")).slice(0, issueRowLimit) : [];
  return <SupplierPage title="Manuel yükleme" tabsLabel="Manuel yükleme" syncLabel="Yükleme ve kontrol"
    description="Şablondaki .xlsx listeleri bir tedarikçi listesi gibi içe aktarılır: önce kontrol edilir, onaydan sonra mağazaya yansır."
    badge={<Button variant="outline" nativeButton={false} render={<a href={`${base}/sablon`} download/>}><Download data-icon="inline-start" aria-hidden="true"/>Boş şablonu indir</Button>}
    attention={Boolean(draft || params.error)} hasData={Boolean(list)} tabKey={[params.taslak, params.error, params.imported].join("|")}
    alerts={<>
    {params.uploaded === "1" && <Alert variant="info" role="status"><Info aria-hidden="true"/><AlertDescription>{draft?.kind === "bulk"
      ? "Dosya okundu. Değişiklikleri kontrol edip ürünleri güncelleyin; onaylanana kadar hiçbir ürün değişmez."
      : "Dosya okundu. Önizlemeyi kontrol edip içe aktarın; onaylanana kadar hiçbir ürün değişmez."}</AlertDescription></Alert>}
    {params.imported === "1" && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertTitle>Liste içe aktarıldı</AlertTitle><AlertDescription>Ürünler mağazada listelenir; kategori sayfaları 10 dakika içinde güncellenir. Mevcut ürünlerle eşleşmeleri için <Link className="underline" href="/yonetim/urun-eslestirme">Ürün eşleştirme</Link> sayfasında eşleştirmeyi yenileyin.</AlertDescription></Alert>}
    {params.bulk === "1" && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertTitle>Fiyat ve stoklar güncellendi</AlertTitle><AlertDescription>Değişen ürünlerin maliyeti, kârlılığı ve stoğu mağazaya yansıdı. Değişiklikler ürün sayfalarının geçmişinde görünür.</AlertDescription></Alert>}
    {params.discarded === "1" && <Alert role="status"><Info aria-hidden="true"/><AlertDescription>Taslaktan vazgeçildi; hiçbir ürün değişmedi.</AlertDescription></Alert>}
    {params.error && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{errors[params.error] || "İşlem tamamlanamadı."}{params.detail && ` (${params.detail})`}</AlertDescription></Alert>}
    </>}
    facts={list && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" role="region" aria-label="Liste özeti">
      {facts.map(([label, value, note]) => <Card key={label} size="sm">
        <CardHeader><CardDescription>{label}</CardDescription><CardTitle className="tabular-nums">{value}</CardTitle></CardHeader>
        <CardContent className="text-muted-foreground">{note}</CardContent>
      </Card>)}
    </div>}
    sync={<div className="flex flex-col gap-4">
      {draft?.kind === "bulk" && <ManualBulkPreview draft={draft} status={uploadStatus(draft.status)} params={params}/>}
      {draft && draft.kind !== "bulk" && <Card>
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
          {draft.report.errors > 0 && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertTitle>{number(draft.report.errors)} hata var</AlertTitle><AlertDescription>Hatalı satırlar içe aktarılamaz. Dosyayı düzeltip yeniden yükleyin.</AlertDescription></Alert>}
          {draft.report.removed > 0 && <Alert variant="warning"><TriangleAlert aria-hidden="true"/><AlertTitle>{number(draft.report.removed)} ürün bu dosyada yok</AlertTitle><AlertDescription>Onaylarsanız “son yüklemede yok” olarak işaretlenir ve mağazadan kalkar; bir sonraki yüklemede de yoksa pasife alınır. {draft.report.removedCodes.slice(0, 20).join(", ")}{draft.report.removed > 20 && "…"}</AlertDescription></Alert>}
          {grouped.length > 0 && <Table controls={false}><caption className="sr-only">Kontrol sonuçlarının özeti</caption>
            <TableHeader><TableRow><TableHead>Seviye</TableHead><TableHead>Alan</TableHead><TableHead>Bulgu</TableHead><TableHead className="text-right">Satır</TableHead><TableHead>Örnek kodlar</TableHead></TableRow></TableHeader>
            <TableBody>{grouped.map(({ issue, count, codes }) => <TableRow key={issueKind(issue)}>
              <TableCell>{issue.level === "error" ? <StatusBadge tone="error">Hata</StatusBadge> : <StatusBadge tone="warning">Uyarı</StatusBadge>}</TableCell>
              <TableCell>{fieldLabel(issue.field)}</TableCell>
              <TableCell className="whitespace-normal">{count === 1 ? issue.message : issue.message.replace(/:.*$/, "")}</TableCell>
              <TableCell className="text-right tabular-nums">{number(count)}</TableCell>
              <TableCell className="whitespace-normal font-mono text-muted-foreground">{codes.join(", ")}{count > codes.length && "…"}</TableCell>
            </TableRow>)}</TableBody>
          </Table>}
          {detailed.length > 0 && <Card size="sm" className="py-0"><CardContent><Accordion><AccordionItem value="rows">
            <AccordionTrigger>Satır satır bulgular ({number(draft.report.issues.length)}{draft.report.issues.length > detailed.length ? `, ilk ${number(detailed.length)} gösteriliyor` : ""})</AccordionTrigger>
            <AccordionContent><Table><caption className="sr-only">Satır satır kontrol sonuçları</caption>
              <TableHeader><TableRow><TableHead>Seviye</TableHead><TableHead>Sayfa</TableHead><TableHead className="text-right">Satır</TableHead><TableHead>Kod</TableHead><TableHead>Alan</TableHead><TableHead>Bulgu</TableHead></TableRow></TableHeader>
              <TableBody>{detailed.map((issue, index) => <TableRow key={index}>
                <TableCell>{issue.level === "error" ? "Hata" : "Uyarı"}</TableCell><TableCell>{issue.sheet || "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{issue.row ?? "—"}</TableCell><TableCell className="font-mono">{issue.code ?? "—"}</TableCell>
                <TableCell>{fieldLabel(issue.field)}</TableCell><TableCell className="whitespace-normal">{issue.message}</TableCell>
              </TableRow>)}</TableBody>
            </Table>
            {draft.report.issues.length > detailed.length && <p className="mt-2 text-muted-foreground">İlk {number(detailed.length)} bulgu gösteriliyor; toplam {number(draft.report.issues.length)}. Hatalar önce listelenir.</p>}</AccordionContent>
          </AccordionItem></Accordion></CardContent></Card>}
          {draft.row_count > 0 && <Table><caption className="sr-only">İlk satırlar</caption>
            <TableHeader><TableRow><TableHead>Kod</TableHead><TableHead>Ürün adı</TableHead><TableHead>Marka</TableHead><TableHead>Kategori</TableHead><TableHead>Ambalaj</TableHead><TableHead>Viskozite</TableHead><TableHead className="text-right">Liste Fiyatı</TableHead><TableHead className="text-right">İskonto</TableHead><TableHead className="text-right">Maliyet</TableHead><TableHead className="text-right">Stok</TableHead></TableRow></TableHeader>
            <TableBody>{draft.preview.map(row => <TableRow key={row.code}>
              <TableCell className="font-mono">{row.code}</TableCell><TableCell className="max-w-96 truncate" title={row.name}>{row.name}</TableCell><TableCell>{row.brand}</TableCell>
              <TableCell>{categoryNames.get(row.categoryId)}</TableCell><TableCell>{row.package ?? <span className="text-warning">Eksik</span>}</TableCell><TableCell>{row.viscosity ?? "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{row.listPrice == null ? "—" : number(row.listPrice)}</TableCell><TableCell className="text-right tabular-nums">{row.listPrice == null ? "—" : `%${number(row.discount ?? 0)}`}</TableCell>
              <TableCell className="text-right tabular-nums">{row.price === null ? "—" : number(row.price)}</TableCell><TableCell className="text-right tabular-nums">{row.stock === null ? "—" : number(row.stock)}</TableCell>
            </TableRow>)}</TableBody>
          </Table>}
          {draft.row_count > draft.preview.length && <p className="text-muted-foreground">İlk 10 satır gösteriliyor; toplam {number(draft.row_count)} ürün.</p>}
        </CardContent>
        {draft.status === "draft" && <CardFooter className="flex-wrap gap-2">
          <form action={confirmManualDraft}><input type="hidden" name="id" value={draft.id}/><input type="hidden" name="list" value={draft.list_group}/>
            <SubmitButton icon={<CircleCheck data-icon="inline-start" aria-hidden="true"/>} pendingLabel="İçe aktarılıyor, resimler indiriliyor…" disabled={draft.report.errors > 0 || !draft.row_count}>{number(draft.report.products)} ürünü içe aktar</SubmitButton></form>
          <form action={discardManualDraft}><input type="hidden" name="id" value={draft.id}/><input type="hidden" name="list" value={draft.list_group}/>
            <SubmitButton variant="ghost">Vazgeç</SubmitButton></form>
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
            <div><SubmitButton icon={<Upload data-icon="inline-start" aria-hidden="true"/>} pendingLabel="Dosya kontrol ediliyor…">Yükle ve kontrol et</SubmitButton></div>
          </form>
        </CardContent>
      </Card>
      {list && <Card>
        <CardHeader><CardTitle><h2>Toplu fiyat ve stok güncelleme (CSV)</h2></CardTitle>
          <CardDescription>{list.list_name} listesini indirin, Excel&apos;de düzenleyip yükleyin. Dosya önce kontrol edilir; onayınız olmadan hiçbir ürün değişmez.</CardDescription>
          <CardAction><Badge variant="outline"><FileSpreadsheet data-icon="inline-start" aria-hidden="true"/>.csv</Badge></CardAction></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
            <li>Boş hücre değişiklik yapmaz.</li>
            <li>Kârlılık Oranı&apos;na “-” yazarsanız ürün genel orana döner.</li>
            <li>Maliyet, liste fiyatı eksi iskontodur: Liste Fiyatı × (1 − İskonto Oranı / 100).</li>
            <li>Ondalık için virgül kullanın (1.234,56); 0 ile başlayan noktalı değerler (0.25) ondalık okunur.</li>
            <li>Marka ve Stok Kodu ürünü bulmak içindir; değiştirmeyin.</li>
            <li>Liste fiyatı ve iskonto xlsx şablonunda da girilebilir; son değiştirilen değer geçerli olur.</li>
          </ul>
          <div><Button variant="outline" nativeButton={false} render={<a href={listCsvHref} download/>}><Download data-icon="inline-start" aria-hidden="true"/>CSV indir</Button></div>
          <form action={uploadManualBulk} className="flex flex-col gap-4">
            <input type="hidden" name="liste" value={list.list_group}/>
            <Field><FieldLabel htmlFor="manual-bulk-file">CSV dosyası</FieldLabel><Input id="manual-bulk-file" name="file" type="file" required accept=".csv,text/csv"/>
              <FieldDescription>Sütunlar: Marka, Stok Kodu, Liste Fiyatı, İskonto Oranı, Kârlılık Oranı, Stok Adedi. En fazla 2 MB.</FieldDescription></Field>
            <div><SubmitButton icon={<Upload data-icon="inline-start" aria-hidden="true"/>} pendingLabel="Dosya kontrol ediliyor…">CSV yükle ve kontrol et</SubmitButton></div>
          </form>
        </CardContent>
      </Card>}
      <Card>
        <CardHeader><CardTitle><h2>Şablon</h2></CardTitle><CardDescription>Sütunlar başlık adıyla bulunur; sıraları ve sayfa adları serbesttir. Kategori, şablondaki Kategoriler sayfasından seçilir.</CardDescription></CardHeader>
        <CardContent><Table controls={false}><caption className="sr-only">Şablon sütunları</caption>
          <TableHeader><TableRow><TableHead>Sütun</TableHead><TableHead>Durum</TableHead><TableHead>Açıklama</TableHead></TableRow></TableHeader>
          <TableBody>{manualColumns.map(column => <TableRow key={column.key}>
            <TableCell className="font-medium">{column.header}</TableCell>
            <TableCell>{column.required ? <StatusBadge tone="info">Zorunlu</StatusBadge> : <StatusBadge tone="neutral">İsteğe bağlı</StatusBadge>}</TableCell>
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
              <TableCell className="max-w-56 truncate" title={upload.file_name}>{upload.kind === "bulk" && <Badge variant="outline"><FileSpreadsheet data-icon="inline-start" aria-hidden="true"/>CSV</Badge>} {upload.file_name}</TableCell>
              <TableCell className="text-right tabular-nums">{number(upload.report.products)}</TableCell>
              <TableCell className="tabular-nums">{upload.report.errors ? <span className="text-destructive">{number(upload.report.errors)} hata</span> : "Hata yok"} · {number(upload.report.warnings)} uyarı</TableCell>
              <TableCell>{uploadStatus(upload.status)}</TableCell>
              <TableCell className="whitespace-normal">{upload.kind === "bulk" ? <span className="text-muted-foreground tabular-nums"><b className="font-medium text-foreground">{number(upload.report.updated)}</b> {upload.status === "imported" ? "ürün değişti" : "ürün değişecek"}</span> : upload.stats ? <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-muted-foreground tabular-nums">{([["added", "yeni"], ["changed", "değişen"], ["unchanged", "aynı"], ["missing", "listede yok"], ["inactive", "pasif"], ["restored", "geri gelen"]] as const).map(([key, label]) => <span key={key}><b className="font-medium text-foreground">{number(upload.stats![key] ?? 0)}</b> {label}</span>)}</div> : "—"}
                {upload.quality?.imagesStored !== undefined && <span className="block text-muted-foreground tabular-nums">{number(upload.quality.imagesStored)} resim kaydedildi{upload.quality.imagesFailed ? ` · ${number(upload.quality.imagesFailed)} indirilemedi` : ""}</span>}</TableCell>
            </TableRow>)}</TableBody>
          </Table> : <Empty><EmptyHeader><EmptyMedia variant="icon"><History/></EmptyMedia><EmptyTitle>Henüz yükleme yok</EmptyTitle></EmptyHeader></Empty>}
        </CardContent>
      </Card>
    </div>}
    products={<SupplierBrowser><Card>
      {list && <CardHeader className="border-b">
        <ManualProductFilters key={[params.liste, params.q, params.category, params.stock, params.presence, params.quality].join("|")} params={params} list={list.list_group}
          lists={lists.map(entry => ({ value: entry.list_group, label: entry.list_name }))} categories={listCategories}/>
      </CardHeader>}
      {!list || !products ? <CardContent><Empty><EmptyHeader><EmptyMedia variant="icon"><PackageSearch/></EmptyMedia><EmptyTitle>Henüz manuel liste yok.</EmptyTitle><EmptyDescription>Yükleme sekmesinden şablondaki bir dosyayı yükleyin.</EmptyDescription></EmptyHeader></Empty></CardContent> : <>
      <CardContent className="flex flex-col gap-3 group-data-loading/browser:pointer-events-none group-data-loading/browser:opacity-50">
        <div className="flex flex-wrap justify-between gap-2 text-muted-foreground tabular-nums"><span><strong className="text-foreground">{number(products.total)}</strong> ürün · {params.category || "Tüm kategoriler"}</span><span className="flex flex-wrap items-center gap-2">{costNotes.manual}<Button variant="outline" size="sm" nativeButton={false} render={<a href={csvHref} download/>}><Download data-icon="inline-start" aria-hidden="true"/>{filtered ? "Süzülmüş listeyi CSV indir" : "CSV indir"}</Button></span></div>
        <SupplierPartTable {...manualPartTableProps(products.items, { categories: listCategories })} empty={supplierPartEmpty(base, params, filterKeys, ["liste"])}/>
      </CardContent>
      <CardFooter><SupplierPagination base={base} params={params} keys={filterKeys} page={page} pages={pages} capped={products?.capped}/></CardFooter>
      </>}
    </Card></SupplierBrowser>}/>;
}
