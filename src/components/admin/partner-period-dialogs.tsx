"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Lock, LockOpen, TriangleAlert } from "lucide-react";
import { closePartnerPeriod, reopenPartnerPeriod, type PartnerPeriodResult } from "@/modules/admin/partner-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

/** `label` is the month as the page shows it ("Ekim 2026"), formatted on the server. */
type Props = { partner: string; period: string; label: string };
type FormProps = Omit<Props, "label"> & { onSaved: () => void };

/** Submits a period action and, on success, closes the dialog and shows the page's result. */
function usePeriodAction(action: (previous: PartnerPeriodResult, form: FormData) => Promise<PartnerPeriodResult>, onSaved: () => void) {
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [result, submit, pending] = useActionState(async (previous: PartnerPeriodResult, form: FormData) => {
    const next = await action(previous, form);
    if (next.status === "success") { onSaved(); if (next.next) router.replace(next.next, { scroll: false }); }
    return next;
  }, { status: "idle" });
  // noValidate: the browser no longer focuses the first invalid field, so do it once the server errors are shown.
  useEffect(() => { if (!pending && result.errors) formRef.current?.querySelector<HTMLElement>("[aria-invalid=\"true\"]")?.focus(); }, [pending, result]);
  return { formRef, result, submit, pending };
}

/**
 * "Dönemi kapat" (#1200): closes a partner's month with an optional note. Invoices dated in it and payments paid in it are
 * then frozen until the month is reopened with a reason.
 */
export function PartnerPeriodCloseDialog({ partner, period, label, current }: Props & { current: boolean }) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button variant="outline" size="sm" aria-label={`Dönemi kapat: ${partner} ${label}`}/>}>
      <Lock data-icon="inline-start" aria-hidden="true"/>Dönemi kapat
    </DialogTrigger>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{partner} · {label} dönemini kapat</DialogTitle>
        <DialogDescription>Kapatılan dönem gerekçeyle yeniden açılana kadar değiştirilemez; kapanış, dönem kapanış geçmişine yazılır.</DialogDescription>
      </DialogHeader>
      {/* Remounted on each open: the note starts empty and the last result is not shown again. */}
      {open && <CloseForm partner={partner} period={period} current={current} onSaved={() => setOpen(false)}/>}
    </DialogContent>
  </Dialog>;
}

function CloseForm({ partner, period, current, onSaved }: FormProps & { current: boolean }) {
  const id = useId();
  // Controlled: React 19 resets an action form after submit, so an error result would otherwise clear what was typed.
  const [note, setNote] = useState("");
  const { formRef, result, submit, pending } = usePeriodAction(closePartnerPeriod, onSaved);
  const errors = result.errors ?? {};
  const describedBy = [`${id}-note-hint`, errors.note && `${id}-note-error`].filter(Boolean).join(" ");

  return <form ref={formRef} action={submit} noValidate className="flex min-w-0 flex-col gap-4">
    <input type="hidden" name="partner" value={partner}/>
    <input type="hidden" name="period" value={period}/>
    <Alert variant="warning" role="status"><TriangleAlert aria-hidden="true"/><AlertDescription>
      <p>Bu aya tarihli faturalar işaretlenemez, düzeltilemez ya da geri alınamaz. Ödeme tarihi bu ayda olan tahsilatlar girilemez ya da iptal edilemez. Sonraki aylara tarihli tahsilatlar girilebilir.</p>
      <p>Dönemler sırayla kapatılır: hareketi olan önceki aylar önce kapatılmalı.</p>
      {current && <p>Bu ay henüz bitmedi; kapatırsanız bugün tarihli fatura ve tahsilat girilemez.</p>}
    </AlertDescription></Alert>
    <fieldset disabled={pending} className="min-w-0"><FieldGroup>
      <Field data-invalid={Boolean(errors.note)}>
        <FieldLabel htmlFor={`${id}-note`}>Not</FieldLabel>
        <Textarea id={`${id}-note`} name="note" maxLength={500} value={note} onChange={event => setNote(event.currentTarget.value)}
          aria-invalid={Boolean(errors.note)} aria-describedby={describedBy}/>
        <FieldDescription id={`${id}-note-hint`}>İsteğe bağlı; dönem kapanış geçmişinde görünür (en fazla 500 karakter).</FieldDescription>
        {errors.note && <FieldError id={`${id}-note-error`}>{errors.note[0]}</FieldError>}
      </Field>
    </FieldGroup></fieldset>
    {errors.period && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{errors.period[0]}</AlertDescription></Alert>}
    {result.message && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{result.message}</AlertDescription></Alert>}
    <DialogFooter>
      <Button type="submit" disabled={pending}>
        {pending ? <Spinner data-icon="inline-start" aria-hidden="true"/> : <Lock data-icon="inline-start" aria-hidden="true"/>}
        {pending ? "Kaydediliyor…" : "Dönemi kapat"}
      </Button>
    </DialogFooter>
  </form>;
}

/** "Dönemi yeniden aç" (#1200): reopens a closed month with a reason (5–500 characters), kept in the period history. */
export function PartnerPeriodReopenDialog({ partner, period, label }: Props) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button variant="outline" size="sm" aria-label={`Dönemi yeniden aç: ${partner} ${label}`}/>}>
      <LockOpen data-icon="inline-start" aria-hidden="true"/>Yeniden aç
    </DialogTrigger>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{partner} · {label} dönemini yeniden aç</DialogTitle>
        <DialogDescription>Yeniden açılan dönemde faturalar ve tahsilatlar yine değiştirilebilir; gerekçe dönem kapanış geçmişine yazılır.</DialogDescription>
      </DialogHeader>
      {open && <ReopenForm partner={partner} period={period} onSaved={() => setOpen(false)}/>}
    </DialogContent>
  </Dialog>;
}

function ReopenForm({ partner, period, onSaved }: FormProps) {
  const id = useId();
  const [reason, setReason] = useState("");
  const { formRef, result, submit, pending } = usePeriodAction(reopenPartnerPeriod, onSaved);
  const errors = result.errors ?? {};
  const describedBy = [`${id}-reason-hint`, errors.reason && `${id}-reason-error`].filter(Boolean).join(" ");

  return <form ref={formRef} action={submit} noValidate className="flex min-w-0 flex-col gap-4">
    <input type="hidden" name="partner" value={partner}/>
    <input type="hidden" name="period" value={period}/>
    <fieldset disabled={pending} className="min-w-0"><FieldGroup>
      <Field data-invalid={Boolean(errors.reason)}>
        <FieldLabel htmlFor={`${id}-reason`}>Gerekçe</FieldLabel>
        <Textarea id={`${id}-reason`} name="reason" required minLength={5} maxLength={500} value={reason} onChange={event => setReason(event.currentTarget.value)}
          aria-invalid={Boolean(errors.reason)} aria-describedby={describedBy}/>
        <FieldDescription id={`${id}-reason-hint`}>Dönem kapanış geçmişinde görünür (5–500 karakter).</FieldDescription>
        {errors.reason && <FieldError id={`${id}-reason-error`}>{errors.reason[0]}</FieldError>}
      </Field>
    </FieldGroup></fieldset>
    {errors.period && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{errors.period[0]}</AlertDescription></Alert>}
    {result.message && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{result.message}</AlertDescription></Alert>}
    <DialogFooter>
      <Button type="submit" disabled={pending}>
        {pending ? <Spinner data-icon="inline-start" aria-hidden="true"/> : <LockOpen data-icon="inline-start" aria-hidden="true"/>}
        {pending ? "Kaydediliyor…" : "Dönemi yeniden aç"}
      </Button>
    </DialogFooter>
  </form>;
}
