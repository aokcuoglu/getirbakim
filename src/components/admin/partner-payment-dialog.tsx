"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, CircleAlert, Info } from "lucide-react";
import { recordPartnerPayment, type PartnerPaymentResult } from "@/modules/admin/partner-actions";
import { formatDay } from "@/modules/admin/format";
import { paymentMethodLabels, paymentMethods } from "@/modules/partner/payment-methods";
import { money } from "@/modules/store/money";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

export type CollectableInvoice = { partner: string; invoiceRef: string; invoiceDate: string; totalKurus: number; collectedKurus: number; balanceKurus: number };

/** Kuruş → the TL text the amount input starts with ("4500" or "4500,50"). */
const tlText = (kurus: number) => kurus % 100 ? (kurus / 100).toFixed(2).replace(".", ",") : String(kurus / 100);

/**
 * "Tahsilat gir" (#1006): records what the partner paid towards one invoice. The amount starts at the balance; partial
 * payments are fine, more than the balance is refused. The server refuses an invoice whose total or collected amount
 * changed since it was shown (so a double submit records once).
 */
export function PartnerPaymentDialog({ invoice, today }: { invoice: CollectableInvoice; today: string }) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button variant="outline" size="sm" aria-label={`${invoice.partner} ${invoice.invoiceRef} faturasına tahsilat gir`}/>}>
      <Banknote data-icon="inline-start" aria-hidden="true"/>Tahsilat gir
    </DialogTrigger>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{invoice.partner} · {invoice.invoiceRef} için tahsilat</DialogTitle>
        <DialogDescription>{formatDay(invoice.invoiceDate)} tarihli faturaya partnerin yaptığı ödemeyi girin. Kısmi ödeme girilebilir; tahsilat cari limiti değiştirmez.</DialogDescription>
      </DialogHeader>
      {/* Remounted on each open: fields start from the current balance and the last result is not shown again. */}
      {open && <PaymentForm invoice={invoice} today={today} onSaved={() => setOpen(false)}/>}
    </DialogContent>
  </Dialog>;
}

function PaymentForm({ invoice, today, onSaved }: { invoice: CollectableInvoice; today: string; onSaved: () => void }) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  // Controlled: React 19 resets an action form after submit, so an error result would otherwise clear what was typed.
  const [values, setValues] = useState({ amount: tlText(invoice.balanceKurus), paidOn: today, method: "bank_transfer", note: "" });
  const set = (field: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const value = event.currentTarget.value;
    setValues(previous => ({ ...previous, [field]: value }));
  };
  const [result, submit, pending] = useActionState(async (previous: PartnerPaymentResult, form: FormData) => {
    const next = await recordPartnerPayment(previous, form);
    if (next.status === "success") { onSaved(); if (next.next) router.replace(next.next, { scroll: false }); }
    return next;
  }, { status: "idle" });
  const errors = result.errors ?? {};
  // noValidate: the browser no longer focuses the first invalid field, so do it once the server errors are shown.
  useEffect(() => { if (!pending && result.errors) formRef.current?.querySelector<HTMLElement>("[aria-invalid=\"true\"]")?.focus(); }, [pending, result]);
  const describe = (field: keyof typeof errors, hint = false) => [hint && `${id}-${field}-hint`, errors[field] && `${id}-${field}-error`].filter(Boolean).join(" ") || undefined;

  return <form ref={formRef} action={submit} noValidate className="flex min-w-0 flex-col gap-4">
    <input type="hidden" name="partner" value={invoice.partner}/>
    <input type="hidden" name="invoiceRef" value={invoice.invoiceRef}/>
    <input type="hidden" name="invoiceDate" value={invoice.invoiceDate}/>
    <input type="hidden" name="expectedTotal" value={invoice.totalKurus}/>
    <input type="hidden" name="expectedCollected" value={invoice.collectedKurus}/>
    <Alert variant="info" role="status"><Info aria-hidden="true"/><AlertDescription>
      Fatura tutarı <span className="tabular-nums">{money(invoice.totalKurus)}</span> · tahsil edilen <span className="tabular-nums">{money(invoice.collectedKurus)}</span> · kalan <span className="font-medium tabular-nums">{money(invoice.balanceKurus)}</span>
    </AlertDescription></Alert>
    <fieldset disabled={pending} className="min-w-0"><FieldGroup>
      <Field data-invalid={Boolean(errors.amount)}>
        <FieldLabel htmlFor={`${id}-amount`}>Tutar</FieldLabel>
        <InputGroup>
          <InputGroupInput id={`${id}-amount`} name="amount" inputMode="decimal" required autoComplete="off" className="text-right tabular-nums" value={values.amount} onChange={set("amount")}
            aria-invalid={Boolean(errors.amount)} aria-describedby={describe("amount", true)}/>
          <InputGroupAddon align="inline-end"><InputGroupText>TL</InputGroupText></InputGroupAddon>
        </InputGroup>
        <FieldDescription id={`${id}-amount-hint`}>En fazla kalan tutar kadar; kuruş için virgül kullanın.</FieldDescription>
        {errors.amount && <FieldError id={`${id}-amount-error`}>{errors.amount[0]}</FieldError>}
      </Field>
      <Field data-invalid={Boolean(errors.paidOn)}>
        <FieldLabel htmlFor={`${id}-paidOn`}>Ödeme tarihi</FieldLabel>
        <Input id={`${id}-paidOn`} name="paidOn" type="date" required max={today} value={values.paidOn} onChange={set("paidOn")}
          aria-invalid={Boolean(errors.paidOn)} aria-describedby={describe("paidOn")}/>
        {errors.paidOn && <FieldError id={`${id}-paidOn-error`}>{errors.paidOn[0]}</FieldError>}
      </Field>
      <Field data-invalid={Boolean(errors.method)}>
        <FieldLabel htmlFor={`${id}-method`}>Ödeme yöntemi</FieldLabel>
        <NativeSelect id={`${id}-method`} name="method" required value={values.method} onChange={set("method")}
          aria-invalid={Boolean(errors.method)} aria-describedby={describe("method", true)}>
          {paymentMethods.map(method => <NativeSelectOption key={method} value={method}>{paymentMethodLabels[method]}</NativeSelectOption>)}
        </NativeSelect>
        <FieldDescription id={`${id}-method-hint`}>İade faturasıyla kapanan kısım için &quot;Mahsup (iade faturası)&quot; seçin.</FieldDescription>
        {errors.method && <FieldError id={`${id}-method-error`}>{errors.method[0]}</FieldError>}
      </Field>
      <Field data-invalid={Boolean(errors.note)}>
        <FieldLabel htmlFor={`${id}-note`}>Not (isteğe bağlı)</FieldLabel>
        <Textarea id={`${id}-note`} name="note" maxLength={500} value={values.note} onChange={set("note")}
          aria-invalid={Boolean(errors.note)} aria-describedby={describe("note", true)}/>
        <FieldDescription id={`${id}-note-hint`}>Dekont, çek ya da iade faturası numarası gibi (en fazla 500 karakter).</FieldDescription>
        {errors.note && <FieldError id={`${id}-note-error`}>{errors.note[0]}</FieldError>}
      </Field>
    </FieldGroup></fieldset>
    {result.message && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{result.message}</AlertDescription></Alert>}
    <DialogFooter>
      <Button type="submit" disabled={pending}>
        {pending ? <Spinner data-icon="inline-start" aria-hidden="true"/> : <Banknote data-icon="inline-start" aria-hidden="true"/>}
        {pending ? "Kaydediliyor…" : "Tahsilatı kaydet"}
      </Button>
    </DialogFooter>
  </form>;
}
