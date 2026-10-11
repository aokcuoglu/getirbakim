"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { EnrichmentVehicles } from "./enrichment-vehicles";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function EnrichmentDetails({ name, code, productId, children, footer }: { name: string; code: string; productId: string; footer?: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button variant="outline" aria-label={`${code} kayıt ayrıntıları`}/>}>Ayrıntı<ChevronRight data-icon="inline-end"/></DialogTrigger>
    <DialogContent className="sm:max-w-4xl">
      <DialogHeader>
        <DialogTitle>{name || code}</DialogTitle>
        <DialogDescription>Kaynak ve takip · <span className="font-mono">{code}</span></DialogDescription>
      </DialogHeader>
      <div className="-mx-4 flex max-h-128 flex-col gap-5 overflow-y-auto px-4">{children}{open && <EnrichmentVehicles productId={productId}/>}</div>
      {footer && <DialogFooter>{footer}</DialogFooter>}
    </DialogContent>
  </Dialog>;
}
