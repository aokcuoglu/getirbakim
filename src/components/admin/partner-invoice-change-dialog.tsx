"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Info, Pencil, TriangleAlert, Undo2 } from "lucide-react";
import { changePartnerInvoiceMark, type PartnerInvoiceChangeResult } from "@/modules/admin/partner-actions";
import { formatDay } from "@/modules/admin/format";
import { money } from "@/modules/store/money";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

/** collectedKurus: the invoice's active payments (#1006); while above 0 the mark cannot be undone. */
export type MarkedInvoice = { partner: string; invoiceRef: string; invoiceDate: string; count: number; totalKurus: number; collectedKurus: number };

/**
 * Düzelt / geri al (#1018): a wrong invoiced mark gets a new invoice number and date, or is removed so its orders count
 * against the partner's limit again. Both need a reason; the server refuses an invoice that changed since it was shown.
 */
export function PartnerInvoiceChangeDialog({ invoice, today }: { invoice: MarkedInvoice; today: string }) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button variant="outline" size="sm" aria-label={`${invoice.partner} ${invoice.invoiceRef} faturasını düzelt veya geri al`}/>}>
      <Pencil data-icon="inline-start" aria-hidden="true"/>Düzelt
    </DialogTrigger>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{invoice.partner} · {invoice.invoiceRef} faturasını düzelt</DialogTitle>
        <DialogDescription>{formatDay(invoice.invoiceDate)} tarihli bu fatura ile işaretlenen siparişlerin fatura bilgisini düzeltin ya da işareti gerekçeyle geri alın. Değişiklik kayıt altına alınır.</DialogDescription>
      </DialogHeader>
      {/* Remounted on each open: fields start from the current invoice and the last result is not shown again. */}
      {open && <ChangeForm invoice={invoice} today={today} onSaved={() => setOpen(false)}/>}
    </DialogContent>
  </Dialog>;
}

function ChangeForm({ invoice, today, onSaved }: { invoice: MarkedInvoice; today: string; onSaved: () => void }) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  // Controlled: React 19 resets an action form after submit, so an error result would otherwise clear what was typed.
  const [action, setAction] = useState<"correct" | "undo">("correct");
  const [values, setValues] = useState({ newInvoiceRef: invoice.invoiceRef, newInvoiceDate: invoice.invoiceDate, reason: "" });
  const set = (field: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = event.currentTarget.value;
    setValues(previous => ({ ...previous, [field]: value }));
  };
  const [result, submit, pending] = useActionState(async (previous: PartnerInvoiceChangeResult, form: FormData) => {
    const next = await changePartnerInvoiceMark(previous, form);
    if (next.status === "success") { onSaved(); if (next.next) router.replace(next.next, { scroll: false }); }
    return next;
  }, { status: "idle" });
  const errors = result.errors ?? {};
  // noValidate: the browser no longer focuses the first invalid field, so do it once the server errors are shown.
  useEffect(() => { if (!pending && result.errors) formRef.current?.querySelector<HTMLElement>("[aria-invalid=\"true\"]")?.focus(); }, [pending, result]);
  const describe = (field: keyof typeof errors, hint = false) => [hint && `${id}-${field}-hint`, errors[field] && `${id}-${field}-error`].filter(Boolean).join(" ") || undefined;
  const collected = invoice.collectedKurus > 0;
  const undo = action === "undo";
  const summary = <><span className="tabular-nums">{invoice.count}</span> sipariş · <span className="tabular-nums">{money(invoice.totalKurus)}</span></>;

  return <form ref={formRef} action={submit} noValidate className="flex min-w-0 flex-col gap-4">
    <input type="hidden" name="partner" value={invoice.partner}/>
    <input type="hidden" name="invoiceRef" value={invoice.invoiceRef}/>
    <input type="hidden" name="invoiceDate" value={invoice.invoiceDate}/>
    <input type="hidden" name="expectedCount" value={invoice.count}/>
    <input type="hidden" name="expectedTotal" value={invoice.totalKurus}/>
    <input type="hidden" name="action" value={action}/>
    <fieldset disabled={pending} className="min-w-0"><FieldGroup>
      <FieldSet>
        <FieldLegend variant="label">Ne yapılacak?</FieldLegend>
        <RadioGroup value={action} onValueChange={value => setAction(value === "undo" ? "undo" : "correct")}>
          <FieldLabel htmlFor={`${id}-correct`}>
            <Field orientation="horizontal">
              <RadioGroupItem value="correct" id={`${id}-correct`}/>
              <FieldContent>
                <FieldTitle>Fatura bilgisini düzelt</FieldTitle>
                <FieldDescription>Fatura numarası veya tarihi yanlış girildiyse.</FieldDescription>
              </FieldContent>
            </Field>
          </FieldLabel>
          <FieldLabel htmlFor={`${id}-undo`}>
            <Field orientation="horizontal" data-disabled={collected ? "true" : undefined}>
              <RadioGroupItem value="undo" id={`${id}-undo`} disabled={collected}/>
              <FieldContent>
                <FieldTitle>İşareti geri al</FieldTitle>
                <FieldDescription>{collected
                  ? <>Bu faturaya <span className="tabular-nums">{money(invoice.collectedKurus)}</span> tahsilat girilmiş; işareti geri almak için önce tahsilatları iptal edin.</>
                  : "Siparişler faturalanmadıysa ya da yanlış siparişler işaretlendiyse."}</FieldDescription>
              </FieldContent>
            </Field>
          </FieldLabel>
        </RadioGroup>
      </FieldSet>
      {!undo && <>
        <Field data-invalid={Boolean(errors.newInvoiceRef)}>
          <FieldLabel htmlFor={`${id}-newInvoiceRef`}>Yeni fatura numarası</FieldLabel>
          <Input id={`${id}-newInvoiceRef`} name="newInvoiceRef" required maxLength={60} autoComplete="off" spellCheck={false} value={values.newInvoiceRef} onChange={set("newInvoiceRef")}
            aria-invalid={Boolean(errors.newInvoiceRef)} aria-describedby={describe("newInvoiceRef")}/>
          {errors.newInvoiceRef && <FieldError id={`${id}-newInvoiceRef-error`}>{errors.newInvoiceRef[0]}</FieldError>}
        </Field>
        <Field data-invalid={Boolean(errors.newInvoiceDate)}>
          <FieldLabel htmlFor={`${id}-newInvoiceDate`}>Yeni fatura tarihi</FieldLabel>
          <Input id={`${id}-newInvoiceDate`} name="newInvoiceDate" type="date" required max={today} value={values.newInvoiceDate} onChange={set("newInvoiceDate")}
            aria-invalid={Boolean(errors.newInvoiceDate)} aria-describedby={describe("newInvoiceDate")}/>
          {errors.newInvoiceDate && <FieldError id={`${id}-newInvoiceDate-error`}>{errors.newInvoiceDate[0]}</FieldError>}
        </Field>
      </>}
      <Field data-invalid={Boolean(errors.reason)}>
        <FieldLabel htmlFor={`${id}-reason`}>Gerekçe</FieldLabel>
        <Textarea id={`${id}-reason`} name="reason" required minLength={5} maxLength={500} value={values.reason} onChange={set("reason")}
          aria-invalid={Boolean(errors.reason)} aria-describedby={describe("reason", true)}/>
        <FieldDescription id={`${id}-reason-hint`}>Düzeltme geçmişinde görünür (5–500 karakter).</FieldDescription>
        {errors.reason && <FieldError id={`${id}-reason-error`}>{errors.reason[0]}</FieldError>}
      </Field>
    </FieldGroup></fieldset>
    {undo
      ? <Alert variant="warning" role="status"><TriangleAlert aria-hidden="true"/><AlertDescription>{summary} yeniden partnerin alacağına ve limitine eklenir. Verilmiş siparişler etkilenmez; yeni siparişler limit dolarsa reddedilir.</AlertDescription></Alert>
      : <Alert variant="info" role="status"><Info aria-hidden="true"/><AlertDescription>{summary} yeni fatura bilgisini alır; alacak değişmez.{collected && " Girilen tahsilatlar da yeni fatura bilgisine taşınır."}</AlertDescription></Alert>}
    {result.message && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{result.message}</AlertDescription></Alert>}
    <DialogFooter>
      <Button type="submit" variant={undo ? "destructive" : "default"} disabled={pending}>
        {pending ? <Spinner data-icon="inline-start" aria-hidden="true"/> : undo ? <Undo2 data-icon="inline-start" aria-hidden="true"/> : <Pencil data-icon="inline-start" aria-hidden="true"/>}
        {pending ? "Kaydediliyor…" : undo ? "İşareti geri al" : "Fatura bilgisini düzelt"}
      </Button>
    </DialogFooter>
  </form>;
}
