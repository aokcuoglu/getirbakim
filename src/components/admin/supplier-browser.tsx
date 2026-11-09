"use client";
import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";

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
      // A filter form keeps the column the table is sorted by (TableHead sortKey).
      const current = new URLSearchParams(window.location.search);
      for (const key of ["sort","dir"]) { const value = current.get(key); if (value && !query.has(key)) query.set(key,value); }
      navigate(`${form.getAttribute("action")}?${query}`);
    }}
    onClickCapture={event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = (event.target as HTMLElement).closest("a");
      if (!link || link.getAttribute("target")) return;
      const url = new URL(link.href);
      if (url.pathname !== window.location.pathname || !url.pathname.startsWith("/yonetim/tedarikciler/")) return;
      event.preventDefault();
      if (link.getAttribute("aria-disabled") !== "true") navigate(url.pathname + url.search);
    }}>
    {pending && <div className="absolute inset-x-0 top-16 z-20 flex justify-center" role="status"><Badge variant="secondary"><Spinner data-icon="inline-start" aria-hidden="true"/>Ürünler yükleniyor…</Badge></div>}
    {children}
  </section>;
}
