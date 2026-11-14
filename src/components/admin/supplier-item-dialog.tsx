"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter, useSelectedLayoutSegment } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

/**
 * Dialog of a supplier product opened from its list (@modal/(.)urun/[id]). The URL is the product's own page, so
 * closing goes back to the list in history; a reload or a shared link opens the full page instead.
 */
export function SupplierItemDialog({ children }: { children: ReactNode }) {
  const router = useRouter();
  const popup = useRef<HTMLDivElement>(null);
  return <Dialog defaultOpen onOpenChange={open => { if (!open) router.back(); }}>
    <DialogContent ref={popup} className="max-h-5/6 overflow-y-auto sm:max-w-5xl"
      initialFocus={() => popup.current?.querySelector<HTMLElement>("[data-slot=dialog-title]") ?? true}>
      {children}
    </DialogContent>
  </Dialog>;
}

/** Shown in the dialog while the product loads (loading.tsx of the intercepting route). */
export function SupplierItemDialogLoading() {
  return <DialogHeader>
    <DialogTitle tabIndex={-1} className="flex items-center gap-2"><Spinner aria-hidden="true"/>Ürün yükleniyor…</DialogTitle>
  </DialogHeader>;
}

/**
 * The supplier layout's @modal slot. Interception also catches a soft navigation that starts on the full product page
 * (the manual list's save redirects back to it), which would stack the dialog over a stale page: that case reloads the
 * URL as a full page instead.
 */
export function SupplierModalSlot({ children }: { children: ReactNode }) {
  const page = useSelectedLayoutSegment();
  const modal = useSelectedLayoutSegment("modal");
  // The slot reports its selected product (its last segment) while a dialog is open, null for page.tsx / default.tsx.
  const overProductPage = page === "urun" && modal !== null;
  useEffect(() => {
    if (overProductPage) window.location.reload();
  }, [overProductPage]);
  return overProductPage ? null : children;
}
