import { History } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RunStatusBadge } from "@/components/admin/status-badge";
import { formatDate, formatDuration, formatNumber } from "@/modules/admin/format";
import { supplierRunError, type SupplierRunErrorSource } from "@/modules/suppliers/run-error";
import { runKindLabel, runScopeLabel } from "@/modules/suppliers/run-status";

/** One supplier_imports row as the history shows it. */
type SupplierRun = {
  id: string; list_group: string; warehouse?: string | null; run_kind?: string | null; status: string;
  started_at: Date; completed_at: Date | null; error_reason: string | null; review_note?: string | null; stats: Record<string, number>;
};

const results = [["added", "yeni"], ["changed", "değişen"], ["unchanged", "aynı"], ["missing", "kayıp"], ["inactive", "pasif"], ["restored", "geri gelen"]] as const;

/** The run history table every API supplier page shows: Başlangıç, Kapsam, Tür, Durum, Süre, Sonuç. */
export function SupplierRunHistory({ runs, supplier, name, emptyDescription = "Zamanlayıcı veya “Kaynağı güncelle” ilk çekimi başlatır." }: {
  runs: SupplierRun[];
  supplier: SupplierRunErrorSource;
  name: string;
  emptyDescription?: string;
}) {
  return <Card>
    <CardHeader><CardTitle><h2>Çekim geçmişi</h2></CardTitle><CardDescription>Son {formatNumber(runs.length)} çekim · İstanbul saati</CardDescription></CardHeader>
    <CardContent>
      {runs.length ? <Table><caption className="sr-only">{name} çekim geçmişi</caption>
        <TableHeader><TableRow><TableHead>Başlangıç</TableHead><TableHead>Kapsam</TableHead><TableHead>Tür</TableHead><TableHead>Durum</TableHead><TableHead className="text-right">Süre</TableHead><TableHead>Sonuç</TableHead></TableRow></TableHeader>
        <TableBody>{runs.map(run => <TableRow key={run.id} className="align-top">
          <TableCell className="tabular-nums"><time dateTime={run.started_at.toISOString()}>{formatDate(run.started_at)}</time><code className="block font-mono text-muted-foreground" title={run.id}>#{run.id.slice(0, 8)}</code></TableCell>
          <TableCell><div className="font-medium">{runScopeLabel(run.list_group)}</div>{supplier === "basbug" && run.warehouse && <div className="text-muted-foreground">{run.warehouse}</div>}</TableCell>
          <TableCell>{runKindLabel(run.run_kind, supplier)}</TableCell>
          <TableCell><RunStatusBadge status={run.status}/></TableCell>
          <TableCell className="text-right tabular-nums">{formatDuration(run.started_at, run.completed_at)}</TableCell>
          <TableCell className="whitespace-normal">
            {run.status === "succeeded" ? <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-muted-foreground tabular-nums">{results.map(([key, label]) => <span key={key}><b className="font-medium text-foreground">{formatNumber(run.stats?.[key])}</b> {label}</span>)}</div>
              : run.error_reason ? supplierRunError(run.error_reason, supplier) : run.status === "running" ? "Çekim sürüyor" : "—"}
            {run.review_note && <div className="text-muted-foreground">İnceleme notu: {run.review_note}</div>}
          </TableCell>
        </TableRow>)}</TableBody>
      </Table> : <Empty><EmptyHeader><EmptyMedia variant="icon"><History/></EmptyMedia><EmptyTitle>Henüz çekim kaydı bulunmuyor</EmptyTitle><EmptyDescription>{emptyDescription}</EmptyDescription></EmptyHeader></Empty>}
    </CardContent>
  </Card>;
}
