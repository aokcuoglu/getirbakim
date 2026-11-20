"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { storeButton } from "@/components/store-button";

/** Copies a product code to the clipboard; the label flips to "Kopyalandı" for two seconds (#702). */
export function CopyCodeButton({ code }: { code: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [state]);
  const copy = () => {
    if (!navigator.clipboard?.writeText) { setState("failed"); return; }
    navigator.clipboard.writeText(code).then(() => setState("copied"), () => setState("failed"));
  };
  return <span className="inline-flex shrink-0 items-center gap-1">
    <Button type="button" variant="ghost" size="icon" className={storeButton({intent:"ghost",size:"icon"})} aria-label="Ürün kodunu kopyala" onClick={copy}>{state === "copied" ? <Check/> : <Copy/>}</Button>
    <span role="status" className={state === "failed" ? "text-xs text-destructive" : "text-xs text-[#26734d]"}>{state === "copied" ? "Kopyalandı" : state === "failed" ? "Kopyalanamadı" : ""}</span>
  </span>;
}
