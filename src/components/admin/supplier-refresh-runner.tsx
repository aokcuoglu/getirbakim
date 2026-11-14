"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, RefreshCw } from "lucide-react";
import { refreshSupplierScope, type SupplierRefreshResult } from "@/app/yonetim/tedarikciler/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";

export type SupplierRefreshTask = { supplier: "basbug" | "dinamik" | "seta"; group: string };
type Result = SupplierRefreshTask & SupplierRefreshResult;

const names: Record<SupplierRefreshTask["supplier"], string> = { basbug: "Başbuğ", dinamik: "Dinamik", seta: "SETA" };
const errors: Record<string, string> = {
  paused: "API çekimleri durduruldu",
  busy: "Başka bir çekim sürüyor; bu tedarikçinin kalanları atlandı",
  config: "Bağlantı ayarları eksik; bu tedarikçinin kalanları atlandı",
  contract: "İstek veya yanıt doğrulanamadı",
  rejected: "Veri kalite kontrolünden geçemedi; önceki veriler korundu",
  upstream: "Tedarikçiden veri alınamadı; önceki veriler korundu",
  forbidden: "Tedarikçi bu sunucunun IP adresine izin vermiyor; bu tedarikçinin kalanları atlandı",
  interrupted: "İşlem sonucu alınamadı; çekim geçmişini ve oturumu kontrol edin. Kalanlar başlatılmadı.",
};
// A held lock, a pause or missing settings affect every remaining scope of that supplier; so does a run of upstream
// failures (one brand returning HTTP 500 does not). Other suppliers keep going.
const stopReasons = new Set(["busy", "paused", "config", "forbidden"]);
const upstreamLimit = 3;

export function SupplierRefreshRunner({ tasks, label, description, ariaLabel }: { tasks: SupplierRefreshTask[]; label: string; description: string; ariaLabel: string }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<SupplierRefreshTask | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [finished, setFinished] = useState(false);
  const labelOf = (task: SupplierRefreshTask) => task.supplier === "seta" ? "SETA" : `${names[task.supplier]} · ${task.group}`;
  const many = new Set(tasks.map(task => task.supplier)).size > 1;
  async function run() {
    if (running) return;
    setRunning(true);
    setFinished(false);
    setResults([]);
    setSkipped(0);
    const completed: Result[] = [];
    const stopped = new Set<string>();
    const upstreamRun: Record<string, number> = {};
    let skippedCount = 0;
    try {
      for (const [index, task] of tasks.entries()) {
        if (stopped.has(task.supplier)) { skippedCount++; setSkipped(skippedCount); continue; }
        setCurrent(task);
        let result: SupplierRefreshResult;
        try { result = await refreshSupplierScope(task.supplier, task.group); }
        catch {
          // A lost connection or session means the request's outcome is unknown.
          completed.push({ ...task, ok: false, error: "interrupted" });
          setResults([...completed]);
          skippedCount += tasks.length - index - 1;
          setSkipped(skippedCount);
          break;
        }
        completed.push({ ...task, ...result });
        setResults([...completed]);
        upstreamRun[task.supplier] = result.error === "upstream" ? (upstreamRun[task.supplier] ?? 0) + 1 : 0;
        if (stopReasons.has(result.error ?? "") || upstreamRun[task.supplier] >= upstreamLimit) stopped.add(task.supplier);
      }
      setFinished(true);
    } finally {
      setCurrent(null);
      setRunning(false);
      router.refresh();
    }
  }
  const succeeded = results.filter(result => result.ok).length;
  const failed = results.length - succeeded;
  const done = results.length + skipped;
  return <section className="flex flex-col gap-3" aria-label={ariaLabel}>
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" onClick={run} disabled={running || !tasks.length}>{running ? <Spinner data-icon="inline-start" aria-hidden="true"/> : <RefreshCw data-icon="inline-start" aria-hidden="true"/>}{running ? "Yenileniyor…" : label}</Button>
      <p className="min-w-0 basis-64 flex-1 text-muted-foreground">{tasks.length ? description : "Yenilenecek kapsam yok; veriler güncel."}</p>
    </div>
    {running && <Progress value={done / Math.max(tasks.length, 1) * 100} aria-label="Güncelleme ilerlemesi"/>}
    <p role="status" aria-live="polite" className="tabular-nums empty:hidden">{running ? `${done} / ${tasks.length} tamamlandı${current ? ` · Şimdi: ${labelOf(current)}` : ""}` : finished ? `${succeeded} başarılı · ${failed} başarısız${skipped ? ` · ${skipped} başlatılmadı` : ""}` : ""}</p>
    {/* Remounted when the run ends: Base UI reads defaultValue only once, so results open when something failed. */}
    {results.length > 0 && <Accordion key={finished ? "finished" : "running"} className="rounded-lg border" defaultValue={finished && failed ? ["results"] : []}><AccordionItem value="results" className="px-4">
      <AccordionTrigger>Güncelleme sonuçları</AccordionTrigger>
      <AccordionContent><ul className="flex flex-col gap-1">{results.map((result, index) => <li key={`${result.supplier}-${result.group}-${index}`} className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{many ? labelOf(result) : result.supplier === "seta" ? "SETA" : result.group}</span>
        <Badge variant={result.ok ? "success" : "destructive"}>{result.ok ? <CircleCheck data-icon="inline-start" aria-hidden="true"/> : <CircleAlert data-icon="inline-start" aria-hidden="true"/>}{result.ok ? "Güncellendi" : "Başarısız"}</Badge>
        {result.ok ? result.products !== undefined && <span className="text-muted-foreground tabular-nums">{new Intl.NumberFormat("tr-TR").format(result.products)} ürün</span>
          : <span className="text-muted-foreground">{errors[result.error || "upstream"] || errors.upstream}</span>}
      </li>)}</ul></AccordionContent>
    </AccordionItem></Accordion>}
  </section>;
}
