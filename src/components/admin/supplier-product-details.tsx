"use client";

import { useRef, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";

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
    <DialogContent className="max-h-svh overflow-y-auto sm:max-w-xl" initialFocus={titleRef} onSubmit={event => event.stopPropagation()}>
      <DialogHeader>
        <DialogTitle ref={titleRef} tabIndex={-1}>{title}</DialogTitle>
        <DialogDescription className="font-mono">{code} · {supplier}</DialogDescription>
      </DialogHeader>
      <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label} className="flex min-w-0 flex-col gap-0.5"><dt className="text-muted-foreground">{label}</dt><dd className="font-medium break-words tabular-nums">{value === null || value === undefined || value === "" ? "—" : value}</dd></div>)}</dl>
      <Separator/>
      <div className="flex flex-col gap-2">
        <h3 className="font-medium">{stockTitle}</h3>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">{stocks.map(({ label, available }) => <div key={label} className="flex flex-col items-start gap-1"><dt className="text-muted-foreground">{label}</dt><dd><Badge variant={available ? "secondary" : "outline"}>{available === null ? "Veri yok" : available ? "Var" : "Yok"}</Badge></dd></div>)}</dl>
      </div>
      <DialogFooter className="sm:justify-between">
        {footer}
        <Button variant="link" nativeButton={false} render={<Link href={detailHref}/>}>Geçmiş ve kaynak verileri<ArrowRight data-icon="inline-end" aria-hidden="true"/></Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
