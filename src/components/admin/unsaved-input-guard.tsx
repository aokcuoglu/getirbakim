"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { leavesPage } from "@/modules/admin/unsaved-navigation";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * While `dirty`, asks before a link click or a page unload throws the form's unsaved input away (#698).
 * Next has no global navigation blocker, so a capture-phase click listener lives only while the form is dirty.
 */
export function UnsavedInputGuard({ dirty }: { dirty: boolean }) {
  const router = useRouter();
  const bypass = useRef(false);
  const leaving = useRef(false);
  const [pending, setPending] = useState<{ anchor: HTMLAnchorElement; href: string } | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { if (leaving.current) return; event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const intercept = (event: MouseEvent) => {
      if (bypass.current) { bypass.current = false; return; }
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor) return;
      const href = leavesPage({
        href: anchor.getAttribute("href"), target: anchor.target, download: anchor.hasAttribute("download"), button: event.button,
        modified: event.ctrlKey || event.metaKey || event.shiftKey || event.altKey, defaultPrevented: event.defaultPrevented,
      }, window.location.href);
      if (href === null) return;
      event.preventDefault();
      event.stopPropagation();
      setPending({ anchor, href });
    };
    window.addEventListener("click", intercept, true);
    return () => window.removeEventListener("click", intercept, true);
  }, [dirty]);

  const leave = () => {
    if (!pending) return;
    const { anchor, href } = pending;
    setPending(null);
    leaving.current = true;
    // The bypass relies on anchor.click() dispatching its click event synchronously.
    bypass.current = true;
    if (anchor.isConnected) anchor.click(); else router.push(href);
    bypass.current = false;
  };

  return <AlertDialog open={pending !== null} onOpenChange={open => { if (!open) setPending(null); }}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Kaydedilmemiş değişiklikler var</AlertDialogTitle>
        <AlertDialogDescription>Bu sayfadan ayrılırsanız girdiğiniz değişiklikler kaybolur. Önce kaydedin ya da kaydetmeden ayrılın.</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Sayfada kal</AlertDialogCancel>
        <AlertDialogAction variant="destructive" onClick={leave}>Kaydetmeden ayrıl</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
