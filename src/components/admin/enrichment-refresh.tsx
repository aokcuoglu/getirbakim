"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function EnrichmentRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <button type="button" className="enrichment-refresh" disabled={pending} aria-busy={pending}
    onClick={() => startTransition(() => router.refresh())}>
    <RefreshCw size={15}/>{pending ? "Yenileniyor…" : "Yenile"}
  </button>;
}
