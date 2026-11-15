"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Copies a product code to the clipboard; the label flips to "Kopyalandı" for two seconds (#702). */
export function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = () => { navigator.clipboard.writeText(code).then(() => setCopied(true), () => setCopied(false)); };
  return <span className="inline-flex items-center gap-1">
    <Button type="button" variant="ghost" size="icon-sm" aria-label="Ürün kodunu kopyala" title="Ürün kodunu kopyala" onClick={copy}>{copied ? <Check/> : <Copy/>}</Button>
    <span role="status" className="text-xs text-[#26734d]">{copied ? "Kopyalandı" : ""}</span>
  </span>;
}
