"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";

/** Re-renders the server page every `seconds` while switched on (and the tab is visible), plus a manual refresh. */
export function LiveRefresh({ seconds = 10, defaultOn = true }: { seconds?: number; defaultOn?: boolean }) {
  const router = useRouter();
  const id = useId();
  const [live, setLive] = useState(defaultOn);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") startTransition(() => router.refresh()); }, seconds * 1000);
    return () => clearInterval(timer);
  }, [live, seconds, router]);
  return <div className="flex flex-wrap items-center gap-3">
    <div className="flex items-center gap-2">
      <Switch id={id} checked={live} onCheckedChange={setLive}/>
      <Label htmlFor={id}>Canlı ({seconds} sn)</Label>
    </div>
    <Button variant="outline" disabled={pending} aria-busy={pending} onClick={() => startTransition(() => router.refresh())}>
      {pending ? <Spinner data-icon="inline-start"/> : <RefreshCw data-icon="inline-start" aria-hidden="true"/>}{pending ? "Yenileniyor…" : "Yenile"}
    </Button>
  </div>;
}
