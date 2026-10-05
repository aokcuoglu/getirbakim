"use client";

import { useEffect, useState } from "react";
import type { VehicleCatalogResponse } from "@/modules/store/vehicle-catalog";

export function useVehicleCatalog(url: string | null, debounce = 0) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ url: string; attempt: number; data?: VehicleCatalogResponse; error?: string } | null>(null);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Araç verileri yüklenemedi.");
        if (!controller.signal.aborted) setResult({ url, attempt, data });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ url, attempt, error: error instanceof Error ? error.message : "Araç verileri yüklenemedi." });
      }
    }, debounce);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [url, debounce, attempt]);
  const current = result?.url === url && result.attempt === attempt ? result : null;
  return { data: current?.data, error: current?.error, loading: !!url && !current, retry: () => setAttempt(value => value + 1) };
}
