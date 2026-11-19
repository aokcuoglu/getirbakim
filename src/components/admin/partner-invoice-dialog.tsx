"use client";

import { useActionState, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, FileCheck, Info, TriangleAlert } from "lucide-react";
import { markPartnerInvoiced, type PartnerInvoiceResult } from "@/modules/admin/partner-actions";
import { money } from "@/modules/store/money";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

export type UninvoicedDay = { day: string; count: number; totalKurus: number };

/**
 * Faturalandı işaretle (#426): the partner's delivered, uninvoiced orders up to a delivery day get one invoice number and
 * date, and leave its limit. The preview below the fields is what will be marked; the server refuses anything else.
 */
export function PartnerInvoiceDialog({ partner, days, today }: { partner: string; days: UninvoicedDay[]; today: string }) {
  const [open, setOpen] = useState(false);
  const noteId = useId();
  return <Dialog open={open} onOpenChange={setOpen}>
    <div className="flex flex-col items-end gap-1">
      <DialogTrigger render={<Button variant="outline" disabled={!days.length} aria-label={`${partner}: Faturalandı işaretle`} aria-describedby={days.length ? undefined : noteId}/>}>
        <FileCheck data-icon="inline-start" aria-hidden="true"/>Faturalandı işaretle
      </DialogTrigger>
      {!days.length && <span id={noteId} className="text-muted-foreground">Faturalanmamış teslim yok</span>}
    </div>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{partner} siparişlerini faturalandı olarak işaretle</DialogTitle>
        <DialogDescription>Seçilen güne kadar teslim edilmiş, faturalanmamış siparişler bu fatura ile kapanır ve partnerin limitinden düşer. İşaret geri alınamaz.</DialogDescription>
      </DialogHeader>
      {/* Remounted on each open: fields start from today and the last result is not shown again. */}
      {open && <InvoiceForm partner={partner} days={days} today={today} onSaved={() => setOpen(false)}/>}
    </DialogContent>
  </Dialog>;
}

function InvoiceForm({ partner, days, today, onSaved }: { partner: string; days: UninvoicedDay[]; today: string; onSaved: () => void }) {
  const id = useId();
  const router = useRouter();
  // Controlled: React 19 resets an action form after submit, so an error result would otherwise clear what was typed.
  const [values, setValues] = useState({ deliveredUntil: today, invoiceRef: "", invoiceDate: today });
  const set = (field: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.currentTarget.value;
    setValues(previous => ({ ...previous, [field]: value }));
  };
  const until = values.deliveredUntil;
  const [result, action, pending] = useActionState(async (previous: PartnerInvoiceResult, form: FormData) => {
    const next = await markPartnerInvoiced(previous, form);
    if (next.status === "success") { onSaved(); if (next.next) router.replace(next.next, { scroll: false }); }
    return next;
  }, { status: "idle" });
  const marked = days.filter(day => day.day <= until);
  const count = marked.reduce((sum, day) => sum + day.count, 0);
  const total = marked.reduce((sum, day) => sum + day.totalKurus, 0);
  const errors = result.errors ?? {};
  const describe = (field: keyof typeof errors, hint = false) => [hint && `${id}-${field}-hint`, errors[field] && `${id}-${field}-error`].filter(Boolean).join(" ") || undefined;

  return <form action={action} className="flex min-w-0 flex-col gap-4">
    <input type="hidden" name="partner" value={partner}/>
    <input type="hidden" name="expectedCount" value={count}/>
    <input type="hidden" name="expectedTotal" value={total}/>
    <fieldset disabled={pending} className="min-w-0"><FieldGroup>
      <Field data-invalid={Boolean(errors.deliveredUntil)}>
        <FieldLabel htmlFor={`${id}-deliveredUntil`}>Bu güne kadar teslim edilenler</FieldLabel>
        <Input id={`${id}-deliveredUntil`} name="deliveredUntil" type="date" required max={today} value={values.deliveredUntil} onChange={set("deliveredUntil")}
          aria-invalid={Boolean(errors.deliveredUntil)} aria-describedby={describe("deliveredUntil", true)}/>
        <FieldDescription id={`${id}-deliveredUntil-hint`}>İlk faturalanmamış teslim: {days[0] ? days[0].day.split("-").reverse().join(".") : "—"}. Teslim günü İstanbul saatine göredir.</FieldDescription>
        {errors.deliveredUntil && <FieldError id={`${id}-deliveredUntil-error`}>{errors.deliveredUntil[0]}</FieldError>}
      </Field>
      <Field data-invalid={Boolean(errors.invoiceRef)}>
        <FieldLabel htmlFor={`${id}-invoiceRef`}>Fatura numarası</FieldLabel>
        <Input id={`${id}-invoiceRef`} name="invoiceRef" required maxLength={60} autoComplete="off" spellCheck={false} value={values.invoiceRef} onChange={set("invoiceRef")}
          aria-invalid={Boolean(errors.invoiceRef)} aria-describedby={describe("invoiceRef")}/>
        {errors.invoiceRef && <FieldError id={`${id}-invoiceRef-error`}>{errors.invoiceRef[0]}</FieldError>}
      </Field>
      <Field data-invalid={Boolean(errors.invoiceDate)}>
        <FieldLabel htmlFor={`${id}-invoiceDate`}>Fatura tarihi</FieldLabel>
        <Input id={`${id}-invoiceDate`} name="invoiceDate" type="date" required max={today} value={values.invoiceDate} onChange={set("invoiceDate")}
          aria-invalid={Boolean(errors.invoiceDate)} aria-describedby={describe("invoiceDate")}/>
        {errors.invoiceDate && <FieldError id={`${id}-invoiceDate-error`}>{errors.invoiceDate[0]}</FieldError>}
      </Field>
    </FieldGroup></fieldset>
    <Alert variant={count ? "info" : "warning"} role="status">
      {count ? <Info aria-hidden="true"/> : <TriangleAlert aria-hidden="true"/>}
      <AlertDescription>{count
        ? <>İşaretlenecek: <span className="tabular-nums">{count}</span> sipariş · <span className="tabular-nums">{money(total)}</span></>
        : "Bu güne kadar teslim edilmiş, faturalanmamış sipariş yok."}</AlertDescription>
    </Alert>
    {result.message && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{result.message}</AlertDescription></Alert>}
    <DialogFooter>
      <Button type="submit" disabled={pending || !count}>
        {pending ? <Spinner data-icon="inline-start" aria-hidden="true"/> : <FileCheck data-icon="inline-start" aria-hidden="true"/>}
        {pending ? "İşaretleniyor…" : count ? `${count} siparişi faturalandı işaretle` : "Faturalandı işaretle"}
      </Button>
    </DialogFooter>
  </form>;
}
