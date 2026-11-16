"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProductFitmentActionResult } from "@/app/yonetim/urunler/fitment-actions";

/**
 * Runs a vehicle fitment server action (#583, #661): one change at a time, its result kept for the alert, the page
 * refreshed with the stored list afterwards. `working(rowKey)` is true for the row whose button started the change.
 */
export function useFitmentChange() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ProductFitmentActionResult | null>(null);
  // The row whose button started the running change: it shows the spinner, the others are only disabled.
  const [busy, setBusy] = useState<string | null>(null);

  const mutate = (action: () => Promise<ProductFitmentActionResult>, onSuccess?: () => void, rowKey: string | null = null) => {
    setResult(null);
    setBusy(rowKey);
    startTransition(async () => {
      const next = await action().catch((): ProductFitmentActionResult => ({ status: "error", message: "Bağlantı kesildi; yeniden deneyin." }));
      setResult(next);
      if (next.status === "success") onSuccess?.();
      router.refresh();
      setBusy(null);
    });
  };
  const working = (rowKey: string) => pending && busy === rowKey;
  return { pending, result, setResult, mutate, working };
}
