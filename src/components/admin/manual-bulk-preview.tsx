import type { ReactNode } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { StatusBadge } from "@/components/admin/status-badge";
import { SubmitButton } from "@/components/admin/submit-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatExact, formatNumber } from "@/modules/admin/format";
import type { ManualUpload } from "@/modules/admin/manual";
import { confirmManualBulk, discardManualDraft } from "@/app/yonetim/tedarikciler/manuel/actions";

// Rows of the change table; the counters above still count every change.
const changeRowLimit = 200;
const issueRowLimit = 500;

type Draft = Pick<ManualUpload, "id" | "list_group" | "list_name" | "file_name" | "status" | "report" | "created_at" | "uploader">;

const value = (number: number | null) => number === null ? "Yok" : formatExact(number);
const percent = (number: number | null) => number === null ? "Genel" : `%${formatExact(number)}`;
const diff = <T,>(pair: [T, T] | undefined, show: (value: T) => string) => pair ? `${show(pair[0])} → ${show(pair[1])}` : "—";

/** Review of a price/stock CSV draft (#832): what confirming changes, row by row, and the findings that block it. */
export function ManualBulkPreview({ draft, status }: { draft: Draft; status: ReactNode }) {
  const { report } = draft;
  const changes = report.bulk?.changes ?? [];
  const issues = [...report.issues].sort((a, b) => Number(a.level === "warning") - Number(b.level === "warning")).slice(0, issueRowLimit);
  const counters = [["Satır", report.products], ["Değişecek", report.updated], ["Değişmeyen", report.bulk?.unchanged ?? 0],
    ["Hata", report.errors], ["Uyarı", report.warnings]] as const;
  return <Card>
    <CardHeader>
      <CardTitle><h2>Toplu fiyat ve stok önizlemesi · {draft.file_name}</h2></CardTitle>
      <CardDescription>{draft.list_name} listesi · {formatDate(draft.created_at)}{draft.uploader && ` · ${draft.uploader}`}</CardDescription>
      <CardAction>{status}</CardAction>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-5">
        {counters.map(([label, count]) => <Card key={label} size="sm"><CardHeader><CardDescription>{label}</CardDescription>
          <CardTitle className={label === "Hata" && count ? "text-destructive tabular-nums" : "tabular-nums"}>{formatNumber(count)}</CardTitle></CardHeader></Card>)}
      </div>
      {report.errors > 0 && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertTitle>{formatNumber(report.errors)} hata var</AlertTitle>
        <AlertDescription>Hatalı dosya uygulanamaz. Dosyayı düzeltip yeniden yükleyin.</AlertDescription></Alert>}
      {issues.length > 0 && <Table controls={false}><caption className="sr-only">Kontrol bulguları</caption>
        <TableHeader><TableRow><TableHead>Seviye</TableHead><TableHead className="text-right">Satır</TableHead><TableHead>Kod</TableHead><TableHead>Bulgu</TableHead></TableRow></TableHeader>
        <TableBody>{issues.map((issue, index) => <TableRow key={index}>
          <TableCell>{issue.level === "error" ? <StatusBadge tone="error">Hata</StatusBadge> : <StatusBadge tone="warning">Uyarı</StatusBadge>}</TableCell>
          <TableCell className="text-right tabular-nums">{issue.row ?? "—"}</TableCell>
          <TableCell className="font-mono">{issue.code ?? "—"}</TableCell>
          <TableCell className="whitespace-normal">{issue.message}</TableCell>
        </TableRow>)}</TableBody>
      </Table>}
      {report.issues.length > issues.length && <p className="text-muted-foreground">İlk {formatNumber(issues.length)} bulgu gösteriliyor; toplam {formatNumber(report.issues.length)}. Hatalar önce listelenir.</p>}
      {changes.length > 0 && <Table><caption className="sr-only">Değişecek ürünler</caption>
        <TableHeader><TableRow><TableHead className="text-right">Satır</TableHead><TableHead>Marka</TableHead><TableHead>Stok Kodu</TableHead>
          <TableHead>Liste Fiyatı</TableHead><TableHead>İskonto</TableHead><TableHead>Maliyet</TableHead><TableHead>Kârlılık</TableHead><TableHead>Stok</TableHead></TableRow></TableHeader>
        <TableBody>{changes.slice(0, changeRowLimit).map(change => <TableRow key={change.id}>
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
      {changes.length > changeRowLimit && <p className="text-muted-foreground">İlk {formatNumber(changeRowLimit)} değişiklik gösteriliyor; toplam {formatNumber(changes.length)} ürün.</p>}
      {!changes.length && !report.errors && <p className="text-muted-foreground">Dosyadaki değerler listedekilerle aynı; değişecek ürün yok.</p>}
    </CardContent>
    {draft.status === "draft" && <CardFooter className="flex-wrap gap-2">
      <form action={confirmManualBulk}><input type="hidden" name="id" value={draft.id}/><input type="hidden" name="list" value={draft.list_group}/>
        <SubmitButton icon={<CircleCheck data-icon="inline-start" aria-hidden="true"/>} pendingLabel="Güncelleniyor…" disabled={report.errors > 0 || !report.updated}>
          {formatNumber(report.updated)} ürünü güncelle</SubmitButton></form>
      <form action={discardManualDraft}><input type="hidden" name="id" value={draft.id}/><input type="hidden" name="list" value={draft.list_group}/>
        <SubmitButton variant="ghost">Vazgeç</SubmitButton></form>
    </CardFooter>}
  </Card>;
}
