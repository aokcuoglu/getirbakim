"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { EnrichmentVehicles } from "./enrichment-vehicles";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function EnrichmentDetails({ name, code, productId, children, footer }: { name: string; code: string; productId: string; footer?: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button variant="outline" size="sm" aria-label={`${code} kayıt ayrıntıları`}/>}>Ayrıntı<ChevronRight/></DialogTrigger>
    <DialogContent className="max-h-[calc(100dvh-3rem)] gap-0 overflow-y-auto p-0 sm:max-w-4xl [&>[data-slot=dialog-close]]:z-20">
      <DialogHeader className="sticky top-0 z-10 border-b bg-popover px-5 py-4">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Kaynak ve takip</p>
        <DialogTitle className="pr-8 text-lg">{name || code}</DialogTitle>
        <DialogDescription className="font-mono text-xs">{code}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-5 px-5 py-5">{children}{open && <EnrichmentVehicles productId={productId}/>}</div>
      {footer}
    </DialogContent>
  </Dialog>;
}
