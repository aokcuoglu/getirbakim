"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleX, TriangleAlert } from "lucide-react";
import { voidPartnerPayment, type PartnerPaymentVoidResult } from "@/modules/admin/partner-actions";
import { formatDay } from "@/modules/admin/format";
import { money } from "@/modules/store/money";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

type Props = { paymentId: string; partner: string; invoiceRef: string; amountKurus: number; paidOn: string };

/**
 * "Tahsilatı iptal et" (#1006): a wrong payment is voided with a reason, never edited or deleted; the invoice's balance
 * opens again and the payment stays in the list as cancelled.
 */
export function PartnerPaymentVoidDialog(props: Props) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button variant="outline" size="sm" aria-label={`Tahsilatı iptal et: ${props.partner} ${props.invoiceRef} ${money(props.amountKurus)}`}/>}>
      <CircleX data-icon="inline-start" aria-hidden="true"/>Tahsilatı iptal et
    </DialogTrigger>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{props.invoiceRef} tahsilatını iptal et</DialogTitle>
        <DialogDescription>{props.partner} partnerinin {formatDay(props.paidOn)} tarihli <span className="tabular-nums">{money(props.amountKurus)}</span> ödemesi gerekçeyle iptal edilir.</DialogDescription>
      </DialogHeader>
      {/* Remounted on each open: the reason starts empty and the last result is not shown again. */}
      {open && <VoidForm {...props} onSaved={() => setOpen(false)}/>}
    </DialogContent>
  </Dialog>;
}

function VoidForm({ paymentId, invoiceRef, amountKurus, onSaved }: Props & { onSaved: () => void }) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  // Controlled: React 19 resets an action form after submit, so an error result would otherwise clear what was typed.
  const [reason, setReason] = useState("");
  const [result, submit, pending] = useActionState(async (previous: PartnerPaymentVoidResult, form: FormData) => {
    const next = await voidPartnerPayment(previous, form);
    if (next.status === "success") { onSaved(); if (next.next) router.replace(next.next, { scroll: false }); }
    return next;
  }, { status: "idle" });
  const errors = result.errors ?? {};
  // noValidate: the browser no longer focuses the first invalid field, so do it once the server errors are shown.
  useEffect(() => { if (!pending && result.errors) formRef.current?.querySelector<HTMLElement>("[aria-invalid=\"true\"]")?.focus(); }, [pending, result]);
  const describedBy = [`${id}-reason-hint`, errors.reason && `${id}-reason-error`].filter(Boolean).join(" ");

  return <form ref={formRef} action={submit} noValidate className="flex min-w-0 flex-col gap-4">
    <input type="hidden" name="payment" value={paymentId}/>
    <Alert variant="warning" role="status"><TriangleAlert aria-hidden="true"/><AlertDescription>
      <span className="tabular-nums">{money(amountKurus)}</span> {invoiceRef} faturasının tahsil edilen tutarından düşer; fatura yeniden açık ya da kısmi ödendi görünür. İptal geri alınamaz; gerekirse tahsilatı yeniden girin.
    </AlertDescription></Alert>
    <fieldset disabled={pending} className="min-w-0"><FieldGroup>
      <Field data-invalid={Boolean(errors.reason)}>
        <FieldLabel htmlFor={`${id}-reason`}>Gerekçe</FieldLabel>
        <Textarea id={`${id}-reason`} name="reason" required minLength={5} maxLength={500} value={reason} onChange={event => setReason(event.currentTarget.value)}
          aria-invalid={Boolean(errors.reason)} aria-describedby={describedBy}/>
        <FieldDescription id={`${id}-reason-hint`}>Tahsilatlar listesinde görünür (5–500 karakter).</FieldDescription>
        {errors.reason && <FieldError id={`${id}-reason-error`}>{errors.reason[0]}</FieldError>}
      </Field>
    </FieldGroup></fieldset>
    {result.message && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{result.message}</AlertDescription></Alert>}
    <DialogFooter>
      <Button type="submit" variant="destructive" disabled={pending}>
        {pending ? <Spinner data-icon="inline-start" aria-hidden="true"/> : <CircleX data-icon="inline-start" aria-hidden="true"/>}
        {pending ? "Kaydediliyor…" : "Tahsilatı iptal et"}
      </Button>
    </DialogFooter>
  </form>;
}
