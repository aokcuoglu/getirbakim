"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SupplierActivity, SupplierName } from "@/modules/suppliers/activity";

const number = (value: number) => new Intl.NumberFormat("tr-TR").format(value);

/**
 * The page's status badge, replaced by a live "fetching" badge while an import of this supplier runs.
 * Polls every 5 s while the tab is visible (and on returning to it) and refreshes the page once the fetch ends.
 */
export function SupplierActivityBadge({ supplier, initial, unit = "grup", children }: {
  supplier: SupplierName; initial: SupplierActivity; unit?: string; children: ReactNode;
}) {
  const router = useRouter();
  const [activity, setActivity] = useState(initial);
  const wasRunning = useRef(initial.running);
  useEffect(() => {
    let stopped = false;
    async function poll() {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch(`/api/admin/supplier-activity?supplier=${supplier}`, { cache: "no-store" });
        if (!response.ok || stopped) return;
        const next: SupplierActivity = await response.json();
        setActivity(next);
        if (wasRunning.current && !next.running) router.refresh();
        wasRunning.current = next.running;
      } catch { /* A missed poll keeps the last known state. */ }
    }
    const timer = setInterval(poll, 5000);
    // Coming back to the tab should not show a fetch that ended meanwhile for another 5 s.
    document.addEventListener("visibilitychange", poll);
    return () => { stopped = true; clearInterval(timer); document.removeEventListener("visibilitychange", poll); };
  }, [supplier, router]);
  if (!activity.running) return children;
  return <span role="status" aria-live="polite">
    {/* StatusBadge's info colors, with the spinner in place of its static dot. */}
    <Badge variant="outline" className="gap-1.5 border-primary/20 bg-primary/10 text-primary"><Loader2 className="size-3 animate-spin" aria-hidden="true"/>Veri çekiliyor…{activity.group && activity.group !== "ALL" ? ` · ${activity.group}` : ""}{activity.completed ? ` · ${number(activity.completed)} ${unit} tamamlandı` : ""}</Badge>
  </span>;
}
