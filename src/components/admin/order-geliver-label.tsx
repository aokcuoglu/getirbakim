"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Tag, TriangleAlert } from "lucide-react";
import { createGeliverShipment } from "@/modules/admin/commerce-actions";
import { parcelPresetKeys, parcelPresets } from "@/modules/shipping/geliver-parcel";
import type { GeliverMode } from "@/modules/shipping/geliver-request";
import type { ShipmentResult } from "@/modules/store/shipment";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";

const sizeFields = [
  { name: "length", label: "Uzunluk (cm)", unit: "cm" }, { name: "width", label: "Genişlik (cm)", unit: "cm" },
  { name: "height", label: "Yükseklik (cm)", unit: "cm" }, { name: "weight", label: "Ağırlık (kg)", unit: "kg" },
] as const;

/**
 * Geliver tab of the ship dialog (#960): picks the package and buys a Yurtiçi label through Geliver in one request.
 * On success (or an unknown reply) the dialog closes and the list shows the outcome; a refusal stays here.
 */
export function GeliverLabelForm({ orderId, back, mode, onSaved, onPendingChange }: {
  orderId: string; back: string; mode: GeliverMode; onSaved: () => void; onPendingChange?: (pending: boolean) => void;
}) {
  const fieldId = useId();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [preset, setPreset] = useState<string>("small");
  // Server errors of fields edited since the last submit; the next submit is validated again.
  const [cleared, setCleared] = useState<ReadonlySet<string>>(new Set());
  const [result, action, pending] = useActionState(async (previous: ShipmentResult, form: FormData): Promise<ShipmentResult> => {
    const next = await createGeliverShipment(previous, form);
    setCleared(new Set());
    if (next.status === "success") { onSaved(); if (next.next) router.replace(next.next, { scroll: false }); }
    return next;
  }, { status: "idle" });
  useEffect(() => { onPendingChange?.(pending); }, [pending, onPendingChange]);
  // noValidate: the browser no longer focuses the first invalid field, so do it once the server errors are shown.
  useEffect(() => { if (!pending && result.errors) formRef.current?.querySelector<HTMLElement>("[aria-invalid=\"true\"]")?.focus(); }, [pending, result]);
  const errors = Object.fromEntries(Object.entries(result.errors ?? {}).filter(([field]) => !cleared.has(field)));
  const clear = (...fields: string[]) => setCleared(previous => new Set([...previous, ...fields]));
  const custom = preset === "custom";

  return <form ref={formRef} action={action} noValidate className="flex min-w-0 flex-col gap-4">
    <input type="hidden" name="id" value={orderId}/>
    <input type="hidden" name="back" value={back}/>
    {mode === "test" && <Alert variant="warning"><TriangleAlert aria-hidden="true"/><AlertDescription>Test modu: ücretsiz deneme etiketi oluşturulur, gerçek kargo çıkmaz; sipariş yine de kargoya verildi olarak işaretlenir.</AlertDescription></Alert>}
    <fieldset disabled={pending} className="min-w-0"><FieldGroup>
      <Field data-invalid={Boolean(errors.preset)}>
        <FieldLabel htmlFor={`${fieldId}-preset`}>Paket</FieldLabel>
        <NativeSelect id={`${fieldId}-preset`} name="preset" className="w-full" required value={preset} onChange={event => { setPreset(event.currentTarget.value); clear("preset", ...sizeFields.map(field => field.name)); }}
          aria-invalid={Boolean(errors.preset)} aria-describedby={[`${fieldId}-preset-hint`, errors.preset && `${fieldId}-preset-error`].filter(Boolean).join(" ")}>
          {parcelPresetKeys.map(key => { const p = parcelPresets[key];
            return <NativeSelectOption key={key} value={key}>{`${p.label} · ${p.length}×${p.width}×${p.height} cm · ${p.weight} kg`}</NativeSelectOption>; })}
          <NativeSelectOption value="custom">Elle gir</NativeSelectOption>
        </NativeSelect>
        <FieldDescription id={`${fieldId}-preset-hint`}>Etiket Yurtiçi Kargo ile alınır; ölçü ve ağırlık kargo ücretini belirler.</FieldDescription>
        {errors.preset && <FieldError id={`${fieldId}-preset-error`}>{errors.preset[0]}</FieldError>}
      </Field>
      {custom && <div className="grid gap-4 sm:grid-cols-2">{sizeFields.map(field => <Field key={field.name} data-invalid={Boolean(errors[field.name])}>
        <FieldLabel htmlFor={`${fieldId}-${field.name}`}>{field.label}</FieldLabel>
        <InputGroup>
          <InputGroupInput id={`${fieldId}-${field.name}`} name={field.name} inputMode="decimal" autoComplete="off" required className="tabular-nums" onChange={() => clear(field.name)}
            aria-invalid={Boolean(errors[field.name])} aria-describedby={errors[field.name] ? `${fieldId}-${field.name}-error` : undefined}/>
          <InputGroupAddon align="inline-end" aria-hidden="true"><InputGroupText>{field.unit}</InputGroupText></InputGroupAddon>
        </InputGroup>
        {errors[field.name] && <FieldError id={`${fieldId}-${field.name}-error`}>{errors[field.name]![0]}</FieldError>}
      </Field>)}</div>}
    </FieldGroup></fieldset>
    {result.message && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{result.message}</AlertDescription></Alert>}
    <DialogFooter>
      <Button type="submit" disabled={pending}>{pending ? <Spinner data-icon="inline-start" aria-hidden="true"/> : <Tag data-icon="inline-start" aria-hidden="true"/>}
        {pending ? "Etiket oluşturuluyor…" : mode === "test" ? "Test etiketi oluştur" : "Etiket oluştur ve kargoya ver"}</Button>
    </DialogFooter>
  </form>;
}
