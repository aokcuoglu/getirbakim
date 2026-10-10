"use client";
import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

export function SupplierBrowser({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function navigate(href: string) {
    startTransition(() => router.push(href, { scroll: false }));
  }
  return <section className="group/browser relative min-w-0" data-loading={pending || undefined} aria-busy={pending}
    onSubmit={event => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      event.preventDefault();
      const query = new URLSearchParams();
      new FormData(form).forEach((value,key) => { if (typeof value === "string" && value) query.set(key,value); });
      navigate(`${form.getAttribute("action")}?${query}`);
    }}
    onClickCapture={event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = (event.target as HTMLElement).closest("a");
      if (!link || link.getAttribute("target")) return;
      const url = new URL(link.href);
      if (url.pathname !== "/yonetim/tedarikciler/basbug") return;
      event.preventDefault();
      if (link.getAttribute("aria-disabled") !== "true") navigate(url.pathname + url.search);
    }}>
    {pending && <div className="absolute top-16 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-foreground px-3 py-2 text-sm text-background shadow-lg" role="status"><Loader2 className="size-4 animate-spin" aria-hidden="true"/>Ürünler yükleniyor…</div>}
    {children}
  </section>;
}
