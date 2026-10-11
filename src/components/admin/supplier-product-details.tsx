"use client";

import { useRef, type ReactNode } from "react";
import Link from "next/link";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function SupplierProductDetails({ children, code, title, supplier, fields, stocks, stockTitle, detailHref, footer }: {
  children: ReactNode;
  code: string;
  title: string;
  supplier: string;
  fields: [string, string | number | null | undefined][];
  stocks: { label: string; available: boolean | null }[];
  stockTitle: string;
  detailHref: string;
  footer?: ReactNode;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  return <Dialog>
    {children}
    <DialogContent className="admin-app max-h-[85dvh] overflow-y-auto sm:max-w-xl" initialFocus={titleRef} onSubmit={event => event.stopPropagation()}>
      <DialogHeader className="pr-8">
        <DialogTitle ref={titleRef} tabIndex={-1} className="break-words leading-snug outline-none">{title}</DialogTitle>
        <DialogDescription className="break-words font-mono">{code} · {supplier}</DialogDescription>
      </DialogHeader>
      <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 break-words font-medium tabular-nums">{value === null || value === undefined || value === "" ? "—" : value}</dd></div>)}</dl>
      <div className="border-t pt-3">
        <h3 className="mb-2 text-sm font-semibold">{stockTitle}</h3>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">{stocks.map(({ label, available }) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className={cn("mt-0.5 inline-flex items-center gap-1.5 font-medium", available === null ? "text-amber-700 dark:text-amber-400" : available ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}><span className={cn("size-1.5 rounded-full", available === null ? "bg-amber-500" : available ? "bg-emerald-500" : "bg-muted-foreground/40")} aria-hidden="true"/>{available === null ? "Veri yok" : available ? "Var" : "Yok"}</dd></div>)}</dl>
      </div>
      <div className="flex flex-col gap-3 border-t pt-3">
        {footer}
        <Link className="w-fit text-xs font-medium text-primary hover:underline" href={detailHref}>Geçmiş ve kaynak verileri →</Link>
      </div>
    </DialogContent>
  </Dialog>;
}
