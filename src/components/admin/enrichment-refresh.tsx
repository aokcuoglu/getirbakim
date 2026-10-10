"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EnrichmentRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <Button variant="outline" disabled={pending} aria-busy={pending} onClick={() => startTransition(() => router.refresh())}>
    <RefreshCw className={pending ? "animate-spin" : undefined} aria-hidden="true"/>{pending ? "Yenileniyor…" : "Yenile"}
  </Button>;
}
