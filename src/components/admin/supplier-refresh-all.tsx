"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, RefreshCw } from "lucide-react";
import { refreshBasbugGroup } from "@/app/yonetim/tedarikciler/basbug/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";

type Result = { group: string; ok: boolean; error?: string };
const errors: Record<string, string> = {
  paused: "Başbuğ API çekimleri durduruldu",
  busy: "Başka bir çekim sürüyor; toplu güncelleme durduruldu",
  config: "Bağlantı ayarları kontrol edilmeli",
  contract: "İstek veya yanıt doğrulanamadı",
  rejected: "Veri kalite kontrolünden geçemedi; önceki veriler korundu",
  upstream: "Başbuğ servisinden veri alınamadı; önceki veriler korundu",
};

export function SupplierRefreshAll({ groups }: { groups: string[] }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [finished, setFinished] = useState(false);
  const uniqueGroups = [...new Set(groups)];
  async function refreshAll() {
    if (running) return;
    setRunning(true);
    setFinished(false);
    setResults([]);
    const completed: Result[] = [];
    try {
      for (const group of uniqueGroups) {
        setCurrent(group);
        let result: Awaited<ReturnType<typeof refreshBasbugGroup>>;
        try { result = await refreshBasbugGroup(group); }
        catch {
          // A lost connection or session means the request's outcome is unknown.
          completed.push({ group, ok: false, error: "interrupted" });
          setResults([...completed]);
          break;
        }
        completed.push({ group, ...result });
        setResults([...completed]);
        if (result.error === "busy" || result.error === "paused") break;
      }
      setFinished(true);
    } finally {
      setCurrent("");
      setRunning(false);
      router.refresh();
    }
  }
  const succeeded = results.filter(result => result.ok).length;
  const failed = results.filter(result => !result.ok).length;
  return <section className="flex flex-col gap-3" aria-label="Tüm Başbuğ gruplarını güncelle">
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" onClick={refreshAll} disabled={running || !uniqueGroups.length}>{running ? <Spinner data-icon="inline-start" aria-hidden="true"/> : <RefreshCw data-icon="inline-start" aria-hidden="true"/>}{running ? "Tüm gruplar yenileniyor…" : "Tüm grupları API’den yenile"}</Button>
      <p className="min-w-0 flex-1 text-muted-foreground">{uniqueGroups.length} grup sırayla yenilenir; sayfayı açık tutun.</p>
    </div>
    {running && <Progress value={results.length / Math.max(uniqueGroups.length, 1) * 100} aria-label="Toplu güncelleme ilerlemesi"/>}
    <p role="status" aria-live="polite" className="tabular-nums empty:hidden">{running ? `${results.length} / ${uniqueGroups.length} grup tamamlandı · Şimdi: ${current}` : finished ? `${succeeded} başarılı · ${failed} başarısız${results.length < uniqueGroups.length ? ` · ${uniqueGroups.length - results.length} grup başlatılmadı` : ""}` : ""}</p>
    {results.length > 0 && <Accordion className="rounded-lg border" defaultValue={finished ? ["results"] : []}><AccordionItem value="results" className="px-4">
      <AccordionTrigger>Toplu güncelleme sonuçları</AccordionTrigger>
      <AccordionContent><ul className="flex flex-col gap-1">{results.map(result => <li key={result.group} className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{result.group}</span>
        <Badge variant={result.ok ? "success" : "destructive"}>{result.ok ? <CircleCheck data-icon="inline-start" aria-hidden="true"/> : <CircleAlert data-icon="inline-start" aria-hidden="true"/>}{result.ok ? "Güncellendi" : "Başarısız"}</Badge>
        {!result.ok && <span className="text-muted-foreground">{result.error === "interrupted" ? "İşlem sonucu alınamadı; çekim geçmişini ve oturumu kontrol edin. Kalan gruplar başlatılmadı." : errors[result.error || "upstream"] || errors.upstream}</span>}
      </li>)}</ul></AccordionContent>
    </AccordionItem></Accordion>}
  </section>;
}
