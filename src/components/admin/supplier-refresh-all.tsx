"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { refreshBasbugGroup } from "@/app/yonetim/tedarikciler/basbug/actions";
import { StatusBadge } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";

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
  return <section className="flex flex-col gap-2 border-t pt-4" aria-label="Tüm Başbuğ gruplarını güncelle">
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" onClick={refreshAll} disabled={running || !uniqueGroups.length}><RefreshCw className={running ? "animate-spin" : undefined} aria-hidden="true"/>{running ? "Tüm gruplar yenileniyor…" : "Tüm grupları API’den yenile"}</Button>
      <p className="min-w-60 flex-1 text-sm text-muted-foreground">API grup listesindeki {uniqueGroups.length} grup sırayla çekilir. Ürün, fiyat, MRK stok ve kur verileri yenilenir; işlem sırasında sayfayı açık tutun.</p>
    </div>
    {running && <Progress value={results.length / Math.max(uniqueGroups.length, 1) * 100} aria-label="Toplu güncelleme ilerlemesi"/>}
    <p role="status" aria-live="polite" className="text-sm tabular-nums empty:hidden">{running ? `${results.length} / ${uniqueGroups.length} grup tamamlandı · Şimdi: ${current}` : finished ? `${succeeded} başarılı · ${failed} başarısız${results.length < uniqueGroups.length ? ` · ${uniqueGroups.length - results.length} grup başlatılmadı` : ""}` : ""}</p>
    {results.length > 0 && <Collapsible defaultOpen={finished}>
      <CollapsibleTrigger className="text-sm font-medium hover:underline">Toplu güncelleme sonuçları</CollapsibleTrigger>
      <CollapsibleContent><ul className="mt-2 flex flex-col gap-1 text-sm">{results.map(result => <li key={result.group} className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{result.group}</span>
        <StatusBadge tone={result.ok ? "success" : "error"}>{result.ok ? "Güncellendi" : "Başarısız"}</StatusBadge>
        {!result.ok && <span className="text-muted-foreground">{result.error === "interrupted" ? "İşlem sonucu alınamadı; çekim geçmişini ve oturumu kontrol edin. Kalan gruplar başlatılmadı." : errors[result.error || "upstream"] || errors.upstream}</span>}
      </li>)}</ul></CollapsibleContent>
    </Collapsible>}
  </section>;
}
