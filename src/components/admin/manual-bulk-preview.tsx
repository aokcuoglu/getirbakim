import type { ReactNode } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { StatusBadge } from "@/components/admin/status-badge";
import { SubmitButton } from "@/components/admin/submit-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatExact, formatNumber } from "@/modules/admin/format";
import type { ManualUpload } from "@/modules/admin/manual";
import { ManualBulkPager } from "@/components/admin/manual-bulk-pager";
import { manualBulkPage, manualBulkPageParams } from "@/modules/suppliers/manual-bulk-paging";
import { manualBulkColumns } from "@/modules/suppliers/manual-bulk-csv";
import type { ManualIssue } from "@/modules/suppliers/manual-template";
import { confirmManualBulk, discardManualDraft } from "@/app/yonetim/tedarikciler/manuel/actions";

// report.bulk.changes and report.issues hold one page each (adminManualData); the counts are those of the whole draft.
type Draft = Pick<ManualUpload, "id" | "list_group" | "list_name" | "file_name" | "status" | "report" | "created_at" | "uploader"> & { change_count: number; issue_count: number };
// Params every page link keeps: the draft, the list tab's filters and the other table's page.
const carriedKeys = ["liste", "taslak", "q", "category", "stock", "quality", "presence", "page", "sort", "dir", manualBulkPageParams.changes, manualBulkPageParams.issues] as const;

const value = (number: number | null) => number === null ? "Boş" : formatExact(number);
const percent = (number: number | null) => number === null ? "Genel" : `%${formatExact(number)}`;
const diff = <T,>(pair: [T, T] | undefined, show: (value: T) => string) => pair ? `${show(pair[0])} → ${show(pair[1])}`
  : <><span aria-hidden="true">—</span><span className="sr-only">değişmiyor</span></>;
// "Liste Fiyatı: …" unless the message already names its column.
const finding = (issue: ManualIssue) => {
  const label = manualBulkColumns.find(column => column.key === issue.field)?.header;
  return label && !issue.message.startsWith(label) ? `${label}: ${issue.message}` : issue.message;
};

/** Review of a price/stock CSV draft (#832): what confirming changes, row by row, and the findings that block it. */
export function ManualBulkPreview({ draft, status, params }: { draft: Draft; status: ReactNode; params: Record<string, string | undefined> }) {
  const { report } = draft;
  const changes = report.bulk?.changes ?? [];
  const issues = report.issues;
  // All-lists file (#844): the lists it names; its rows and findings show their list.
  const lists = report.bulk?.lists?.length ? report.bulk.lists : undefined;
  const changePage = manualBulkPage(params[manualBulkPageParams.changes], draft.change_count);
  const issuePage = manualBulkPage(params[manualBulkPageParams.issues], draft.issue_count);
  const hrefFor = (key: string) => (page: number) => {
    const query = new URLSearchParams(carriedKeys.flatMap(name => params[name] && name !== key ? [[name, params[name]!]] : []));
    query.set(key, String(page));
    return `/yonetim/tedarikciler/manuel?${query}`;
  };
  const counters = [["Satır", report.products], ["Değişecek", report.updated], ["Değişmeyen", report.bulk?.unchanged ?? 0],
    ["Hata", report.errors], ["Uyarı", report.warnings]] as const;
  const blocked = report.errors > 0 ? "Hatalar düzeltilmeden güncellenemez." : !report.updated ? "Güncellenecek ürün yok." : null;
  return <Card>
    <CardHeader>
      <CardTitle><h2>Toplu fiyat ve stok önizlemesi</h2></CardTitle>
      <CardDescription className="break-all">{draft.file_name} · {lists ? `${formatNumber(lists.length)} liste` : `${draft.list_name} listesi`} · {formatDate(draft.created_at)}{draft.uploader && ` · ${draft.uploader}`}</CardDescription>
      <CardAction>{status}</CardAction>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {counters.map(([label, count]) => <Card key={label} size="sm"><CardHeader><CardDescription>{label}</CardDescription></CardHeader>
          <CardContent>{label === "Hata" && count
            ? <p className="flex items-center gap-2 text-2xl font-semibold text-destructive tabular-nums"><CircleAlert aria-hidden="true"/>{formatNumber(count)}<span className="sr-only">hata, güncelleme engelli</span></p>
            : <p className="text-2xl font-semibold tabular-nums">{formatNumber(count)}</p>}</CardContent></Card>)}
      </div>
      {lists && <p className="break-words text-muted-foreground">Listeler: {lists.map(list => `${list.name} (${formatNumber(list.rows)} satır)`).join(" · ")}</p>}
      {report.errors > 0 && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertTitle>{formatNumber(report.errors)} hata var</AlertTitle>
        <AlertDescription>Hatalı dosya uygulanamaz. Dosyayı düzeltip yeniden yükleyin.</AlertDescription></Alert>}
      {issuePage.pages > 1 && <p className="text-muted-foreground">{formatNumber(draft.issue_count)} bulgu · hatalar önce listelenir.</p>}
      {issues.length > 0 && <Table server><caption className="sr-only">Kontrol bulguları</caption>
        <TableHeader><TableRow>{lists && <TableHead>Liste</TableHead>}<TableHead>Seviye</TableHead><TableHead className="text-right">Satır</TableHead><TableHead>Stok Kodu</TableHead><TableHead>Bulgu</TableHead></TableRow></TableHeader>
        <TableBody>{issues.map((issue, index) => <TableRow key={index}>
          {lists && <TableCell>{issue.sheet || "—"}</TableCell>}
          <TableCell>{issue.level === "error" ? <StatusBadge tone="error">Hata</StatusBadge> : <StatusBadge tone="warning">Uyarı</StatusBadge>}</TableCell>
          <TableCell className="text-right tabular-nums">{issue.row ?? "—"}</TableCell>
          <TableCell className="font-mono">{issue.code ?? "—"}</TableCell>
          <TableCell className="whitespace-normal">{finding(issue)}</TableCell>
        </TableRow>)}</TableBody>
      </Table>}
      {issues.length > 0 && <ManualBulkPager label="Bulgu sayfaları" total={draft.issue_count} {...issuePage} href={hrefFor(manualBulkPageParams.issues)}/>}
      {changes.length > 0 && <p className="text-muted-foreground">Her hücre eski değer → yeni değeri gösterir; — o alanın değişmediğini belirtir.</p>}
      {changes.length > 0 && <Table server><caption className="sr-only">Değişecek ürünler</caption>
        <TableHeader><TableRow>{lists && <TableHead>Liste</TableHead>}<TableHead className="text-right">Satır</TableHead><TableHead>Marka</TableHead><TableHead>Stok Kodu</TableHead>
          <TableHead>Liste Fiyatı</TableHead><TableHead>İskonto</TableHead><TableHead>Maliyet</TableHead><TableHead>Kârlılık</TableHead><TableHead>Stok</TableHead></TableRow></TableHeader>
        <TableBody>{changes.map(change => <TableRow key={change.id}>
          {lists && <TableCell>{change.listName || "—"}</TableCell>}
          <TableCell className="text-right tabular-nums">{change.row}</TableCell>
          <TableCell>{change.brand}</TableCell>
          <TableCell className="font-mono">{change.code}</TableCell>
          <TableCell className="tabular-nums">{diff(change.listPrice, value)}</TableCell>
          <TableCell className="tabular-nums">{diff(change.discount, number => `%${formatExact(number)}`)}</TableCell>
          <TableCell className="tabular-nums">{diff(change.cost, value)}</TableCell>
          <TableCell className="tabular-nums">{diff(change.markup, percent)}</TableCell>
          <TableCell className="tabular-nums">{diff(change.stock, value)}</TableCell>
        </TableRow>)}</TableBody>
      </Table>}
      {changes.length > 0 && <ManualBulkPager label="Değişiklik sayfaları" total={draft.change_count} {...changePage} href={hrefFor(manualBulkPageParams.changes)}/>}
      {!changes.length && !report.errors && <p className="text-muted-foreground">Dosyadaki değerler listedekilerle aynı; değişecek ürün yok.</p>}
    </CardContent>
    {draft.status === "draft" && <CardFooter className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <form action={confirmManualBulk}><input type="hidden" name="id" value={draft.id}/><input type="hidden" name="list" value={draft.list_group}/>
          <SubmitButton icon={<CircleCheck data-icon="inline-start" aria-hidden="true"/>} pendingLabel="Güncelleniyor…" disabled={Boolean(blocked)}
            aria-describedby={blocked ? "manual-bulk-blocked" : undefined}>{formatNumber(report.updated)} ürünü güncelle</SubmitButton></form>
        <form action={discardManualDraft}><input type="hidden" name="id" value={draft.id}/><input type="hidden" name="list" value={draft.list_group}/>
          <SubmitButton variant="ghost">Vazgeç</SubmitButton></form>
        {blocked && <span id="manual-bulk-blocked" className="text-muted-foreground">{blocked}</span>}
      </div>
      {!blocked && <p className="text-muted-foreground">Onay tüm {formatNumber(report.updated)} değişikliği uygular; maliyet, kârlılık ve stok hemen mağazaya yansır.</p>}
    </CardFooter>}
  </Card>;
}
