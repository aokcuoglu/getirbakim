"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, TriangleAlert, Undo2 } from "lucide-react";
import { undoPartnerOrderInvoiceMark, type PartnerOrderInvoiceUndoResult } from "@/modules/admin/partner-actions";
import { money } from "@/modules/store/money";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

type Props = { orderId: string; number: string; partner: string; invoiceRef: string; invoiceDate: string; totalKurus: number; back: string };

/** `YYYY-MM-DD` → `DD.MM.YYYY`. */
const day = (value: string) => value.split("-").reverse().join(".");

/**
 * "Fatura işaretini geri al" (#1038): removes one partner order from its invoice with a reason, so it counts against the
 * partner's limit again; the invoice's other orders keep their mark. The server refuses a mark that changed since shown.
 */
export function PartnerOrderInvoiceUndoDialog(props: Props) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button variant="outline" size="sm" aria-label={`#${props.number}: fatura işaretini geri al`}/>}>
      <Undo2 data-icon="inline-start" aria-hidden="true"/>Fatura işaretini geri al
    </DialogTrigger>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>#{props.number} siparişinin fatura işaretini geri al</DialogTitle>
        <DialogDescription>{props.partner} · {props.invoiceRef} · {day(props.invoiceDate)} faturasından yalnız bu sipariş çıkarılır. Değişiklik gerekçesiyle kayıt altına alınır.</DialogDescription>
      </DialogHeader>
      {/* Remounted on each open: the reason starts empty and the last result is not shown again. */}
      {open && <UndoForm {...props} onSaved={() => setOpen(false)}/>}
    </DialogContent>
  </Dialog>;
}

function UndoForm({ orderId, number, invoiceRef, invoiceDate, totalKurus, back, onSaved }: Props & { onSaved: () => void }) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  // Controlled: React 19 resets an action form after submit, so an error result would otherwise clear what was typed.
  const [reason, setReason] = useState("");
  const [result, submit, pending] = useActionState(async (previous: PartnerOrderInvoiceUndoResult, form: FormData) => {
    const next = await undoPartnerOrderInvoiceMark(previous, form);
    if (next.status === "success") { onSaved(); if (next.next) router.replace(next.next, { scroll: false }); }
    return next;
  }, { status: "idle" });
  const errors = result.errors ?? {};
  // noValidate: the browser no longer focuses the first invalid field, so do it once the server errors are shown.
  useEffect(() => { if (!pending && result.errors) formRef.current?.querySelector<HTMLElement>("[aria-invalid=\"true\"]")?.focus(); }, [pending, result]);
  const describedBy = [`${id}-reason-hint`, errors.reason && `${id}-reason-error`].filter(Boolean).join(" ");

  return <form ref={formRef} action={submit} noValidate className="flex min-w-0 flex-col gap-4">
    <input type="hidden" name="order" value={orderId}/>
    <input type="hidden" name="invoiceRef" value={invoiceRef}/>
    <input type="hidden" name="invoiceDate" value={invoiceDate}/>
    <input type="hidden" name="back" value={back}/>
    <fieldset disabled={pending} className="min-w-0"><FieldGroup>
      <Field data-invalid={Boolean(errors.reason)}>
        <FieldLabel htmlFor={`${id}-reason`}>Gerekçe</FieldLabel>
        <Textarea id={`${id}-reason`} name="reason" required minLength={5} maxLength={500} value={reason} onChange={event => setReason(event.currentTarget.value)}
          aria-invalid={Boolean(errors.reason)} aria-describedby={describedBy}/>
        <FieldDescription id={`${id}-reason-hint`}>Siparişin fatura düzeltme geçmişinde görünür (5–500 karakter).</FieldDescription>
        {errors.reason && <FieldError id={`${id}-reason-error`}>{errors.reason[0]}</FieldError>}
      </Field>
    </FieldGroup></fieldset>
    <Alert variant="warning" role="status"><TriangleAlert aria-hidden="true"/><AlertDescription>
      #{number} (<span className="tabular-nums">{money(totalKurus)}</span>) {invoiceRef} faturasından çıkarılır ve yeniden partnerin alacağına ve limitine eklenir. Faturadaki diğer siparişler etkilenmez; verilmiş siparişler etkilenmez, yeni siparişler limit dolarsa reddedilir.
    </AlertDescription></Alert>
    {result.message && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{result.message}</AlertDescription></Alert>}
    <DialogFooter>
      <Button type="submit" variant="destructive" disabled={pending}>
        {pending ? <Spinner data-icon="inline-start" aria-hidden="true"/> : <Undo2 data-icon="inline-start" aria-hidden="true"/>}
        {pending ? "Kaydediliyor…" : "İşareti geri al"}
      </Button>
    </DialogFooter>
  </form>;
}
