"use client";

import { useActionState, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Save, Truck } from "lucide-react";
import { saveShipment } from "@/modules/admin/commerce-actions";
import { carrierCodes, carriers, hasTrackingTemplate, resolveTrackingUrl, startingCarrier, yurticiTrackingRule, type ShipmentResult } from "@/modules/store/shipment";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";

export type ShipmentInitial = { carrier: string | null; carrierName: string | null; trackingNo: string | null; trackingUrl: string | null };

/** Kargoya ver (#605): carrier and tracking number for a confirmed order, or a correction while it is shipped. */
export function OrderShipmentDialog({ orderId, number, back, mode, initial }: {
  orderId: string; number: string; back: string; mode: "ship" | "edit"; initial?: ShipmentInitial;
}) {
  const [open, setOpen] = useState(false);
  const initialFocus = useRef<HTMLSelectElement>(null);
  return <Dialog open={open} onOpenChange={setOpen}>
    {mode === "ship"
      ? <DialogTrigger render={<Button aria-label={`#${number} siparişini kargoya ver`}/>}><Truck data-icon="inline-start" aria-hidden="true"/>Kargoya ver</DialogTrigger>
      : <DialogTrigger render={<Button variant="outline" aria-label={`#${number} kargo bilgisini düzenle`}/>}>Kargo bilgisini düzenle</DialogTrigger>}
    <DialogContent initialFocus={initialFocus} className="max-h-5/6 overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{mode === "ship" ? `#${number} siparişini kargoya ver` : `#${number} kargo bilgisi`}</DialogTitle>
        <DialogDescription>{mode === "ship"
          ? "Kargo firmasını ve takip numarasını girin. Müşteri kargosunu sipariş sayfasında bu bilgilerle izler."
          : "Yanlış girilen firma, takip numarası veya bağlantıyı düzeltin. Kargoya veriliş zamanı değişmez."}</DialogDescription>
      </DialogHeader>
      <ShipmentForm orderId={orderId} back={back} mode={mode} initial={initial} initialFocus={initialFocus} onSaved={() => setOpen(false)}/>
    </DialogContent>
  </Dialog>;
}

function ShipmentForm({ orderId, back, mode, initial, initialFocus, onSaved }: {
  orderId: string; back: string; mode: "ship" | "edit"; initial?: ShipmentInitial; initialFocus: React.RefObject<HTMLSelectElement | null>; onSaved: () => void;
}) {
  const fieldId = useId();
  const router = useRouter();
  const startCarrier = startingCarrier(initial?.carrier);
  const startNo = initial?.trackingNo ?? "";
  // A stored link that the carrier template produced is shown as automatic, not as a hand-entered one.
  const startUrl = initial?.trackingUrl && initial.trackingUrl !== resolveTrackingUrl(startCarrier, startNo, null) ? initial.trackingUrl : "";
  const [values, setValues] = useState({ carrier: startCarrier, carrierName: initial?.carrierName ?? "", trackingNo: startNo, trackingUrl: startUrl });
  const [result, action, pending] = useActionState(async (previous: ShipmentResult, form: FormData): Promise<ShipmentResult> => {
    const next = await saveShipment(previous, form);
    // Back to the same tab, sort and page, where the list shows "Sipariş güncellendi."
    if (next.status === "success") { onSaved(); if (next.next) router.replace(next.next, { scroll: false }); }
    return next;
  }, { status: "idle" });
  const errors = result.errors ?? {};
  const set = (field: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = event.currentTarget.value;
    setValues(previous => ({ ...previous, [field]: value }));
  };
  const preview = resolveTrackingUrl(values.carrier, values.trackingNo.replace(/\s+/g, ""), values.trackingUrl.trim() || null);
  const automatic = hasTrackingTemplate(values.carrier);
  const yurtici = values.carrier === "yurtici";
  const describe = (field: string, hint = false) => [hint && `${fieldId}-${field}-hint`, errors[field] && `${fieldId}-${field}-error`].filter(Boolean).join(" ") || undefined;

  return <form action={action} className="flex min-w-0 flex-col gap-4">
    <input type="hidden" name="id" value={orderId}/>
    <input type="hidden" name="mode" value={mode}/>
    <input type="hidden" name="back" value={back}/>
    <fieldset disabled={pending} className="min-w-0"><FieldGroup>
      <Field data-invalid={Boolean(errors.carrier)}>
        <FieldLabel htmlFor={`${fieldId}-carrier`}>Kargo firması</FieldLabel>
        <NativeSelect ref={initialFocus} id={`${fieldId}-carrier`} name="carrier" className="w-full" required value={values.carrier} onChange={set("carrier")}
          aria-invalid={Boolean(errors.carrier)} aria-describedby={describe("carrier")}>
          {carrierCodes.map(code => <NativeSelectOption key={code} value={code}>{carriers[code].label}</NativeSelectOption>)}
        </NativeSelect>
        {errors.carrier && <FieldError id={`${fieldId}-carrier-error`}>{errors.carrier[0]}</FieldError>}
      </Field>
      {values.carrier === "other" && <Field data-invalid={Boolean(errors.carrierName)}>
        <FieldLabel htmlFor={`${fieldId}-carrierName`}>Firma adı</FieldLabel>
        <Input id={`${fieldId}-carrierName`} name="carrierName" required minLength={2} maxLength={60} value={values.carrierName} onChange={set("carrierName")}
          aria-invalid={Boolean(errors.carrierName)} aria-describedby={describe("carrierName")}/>
        {errors.carrierName && <FieldError id={`${fieldId}-carrierName-error`}>{errors.carrierName[0]}</FieldError>}
      </Field>}
      <Field data-invalid={Boolean(errors.trackingNo)}>
        <FieldLabel htmlFor={`${fieldId}-trackingNo`}>Takip numarası</FieldLabel>
        <Input id={`${fieldId}-trackingNo`} name="trackingNo" required autoComplete="off" spellCheck={false} maxLength={60} inputMode={yurtici ? "numeric" : "text"}
          value={values.trackingNo} onChange={set("trackingNo")} aria-invalid={Boolean(errors.trackingNo)} aria-describedby={describe("trackingNo", yurtici)}/>
        {yurtici && <FieldDescription id={`${fieldId}-trackingNo-hint`}>{yurticiTrackingRule} Boşluklar yok sayılır.</FieldDescription>}
        {errors.trackingNo && <FieldError id={`${fieldId}-trackingNo-error`}>{errors.trackingNo[0]}</FieldError>}
      </Field>
      <Field data-invalid={Boolean(errors.trackingUrl)}>
        <FieldLabel htmlFor={`${fieldId}-trackingUrl`}>Takip bağlantısı (isteğe bağlı)</FieldLabel>
        <Input id={`${fieldId}-trackingUrl`} name="trackingUrl" type="url" inputMode="url" placeholder="https://" maxLength={500} value={values.trackingUrl} onChange={set("trackingUrl")}
          aria-invalid={Boolean(errors.trackingUrl)} aria-describedby={describe("trackingUrl", true)}/>
        <FieldDescription id={`${fieldId}-trackingUrl-hint`}>Boş bırakılırsa bilinen firmalarda takip bağlantısı otomatik üretilir.</FieldDescription>
        {errors.trackingUrl && <FieldError id={`${fieldId}-trackingUrl-error`}>{errors.trackingUrl[0]}</FieldError>}
      </Field>
    </FieldGroup></fieldset>
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground">Müşteriye gösterilecek bağlantı</span>
      {preview
        ? <span className="break-all text-foreground">{preview}</span>
        : <span className="text-muted-foreground" aria-live="polite">{automatic ? "Takip numarası girilince otomatik üretilir." : "Bu firma için otomatik bağlantı yok."}</span>}
    </div>
    {result.message && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{result.message}</AlertDescription></Alert>}
    <DialogFooter>
      <Button type="submit" disabled={pending}>{pending ? <Spinner data-icon="inline-start" aria-hidden="true"/> : mode === "ship" ? <Truck data-icon="inline-start" aria-hidden="true"/> : <Save data-icon="inline-start" aria-hidden="true"/>}
        {pending ? "Kaydediliyor…" : mode === "ship" ? "Kargoya ver" : "Kaydet"}</Button>
    </DialogFooter>
  </form>;
}
