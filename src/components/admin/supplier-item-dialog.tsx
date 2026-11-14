"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname, useRouter, useSelectedLayoutSegment } from "next/navigation";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

/**
 * Dialog of a supplier product opened from its list (@modal/(.)urun/[id]). The URL is the product's own page, so
 * closing goes back to the list in history; a reload or a shared link opens the full page instead. The content keeps
 * its header (and the close button) in place and scrolls its body (see SupplierProductDetail `modal`).
 */
export function SupplierItemDialog({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const popup = useRef<HTMLDivElement>(null);
  // Opened by navigation, so the dialog has no trigger to return focus to: the list's link to this product is it.
  const trigger = () => document.querySelector<HTMLElement>(`a[href="${pathname}"]`);
  return <Dialog defaultOpen onOpenChange={open => {
    if (open) return;
    const link = trigger();
    router.back();
    if (link) setTimeout(() => link.focus());
  }}>
    <DialogContent ref={popup} className="flex max-h-5/6 flex-col sm:max-w-5xl" finalFocus={false}
      initialFocus={() => popup.current?.querySelector<HTMLElement>("[data-slot=dialog-title]") ?? true}>
      {children}
    </DialogContent>
  </Dialog>;
}

/** Shown in the dialog while the product loads (loading.tsx of the intercepting route). */
export function SupplierItemDialogLoading() {
  return <>
    <DialogHeader>
      <DialogTitle tabIndex={-1} className="flex items-center gap-2 pr-8"><Spinner aria-label="Yükleniyor"/>Ürün yükleniyor…</DialogTitle>
      <DialogDescription className="sr-only">Tedarikçi ürün ayrıntıları yükleniyor.</DialogDescription>
    </DialogHeader>
    <div className="flex flex-col gap-4">
      <Skeleton className="h-24 w-full"/>
      <div className="grid gap-4 sm:grid-cols-2"><Skeleton className="h-40 w-full"/><Skeleton className="h-40 w-full"/></div>
    </div>
  </>;
}

/**
 * The supplier layout's @modal slot. Interception also catches a soft navigation from a full product page to a product
 * of the same supplier (another product, or the same one again, as the manual list's save redirect does). That would
 * stack the dialog over the stale full page, so the URL is reloaded as a full page instead.
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
