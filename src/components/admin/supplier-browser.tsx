"use client";
import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";

export function SupplierBrowser({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function navigate(href: string) {
    startTransition(() => router.push(href, { scroll: false }));
  }
  return <section className={`supplier-browser ${pending ? "is-loading" : ""}`} aria-busy={pending}
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
    {pending && <div className="supplier-loading" role="status"><span/>Ürünler yükleniyor…</div>}
    {children}
  </section>;
}
