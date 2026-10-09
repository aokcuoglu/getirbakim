"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { refreshBasbugGroup } from "@/app/yonetim/tedarikciler/basbug/actions";

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
  return <section className="supplier-bulk-refresh" aria-label="Tüm Başbuğ gruplarını güncelle">
    <div className="supplier-bulk-actions">
      <button type="button" onClick={refreshAll} disabled={running || !uniqueGroups.length}>{running ? "Tüm gruplar yenileniyor…" : "Tüm grupları API’den yenile"}</button>
      <p>API grup listesindeki {uniqueGroups.length} grup sırayla çekilir. Ürün, fiyat, MRK stok ve kur verileri yenilenir; işlem sırasında sayfayı açık tutun.</p>
    </div>
    <p role="status" aria-live="polite">{running ? `${results.length} / ${uniqueGroups.length} grup tamamlandı · Şimdi: ${current}` : finished ? `${succeeded} başarılı · ${failed} başarısız${results.length < uniqueGroups.length ? ` · ${uniqueGroups.length - results.length} grup başlatılmadı` : ""}` : ""}</p>
    {results.length > 0 && <details open={finished} className="supplier-bulk-results"><summary>Toplu güncelleme sonuçları</summary><ul>{results.map(result => <li key={result.group}><strong>{result.group}</strong> · {result.ok ? "Güncellendi" : result.error === "interrupted" ? "İşlem sonucu alınamadı; çekim geçmişini ve oturumu kontrol edin. Kalan gruplar başlatılmadı." : errors[result.error || "upstream"] || errors.upstream}</li>)}</ul></details>}
  </section>;
}
