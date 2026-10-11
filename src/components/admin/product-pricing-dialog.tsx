"use client";

import { useActionState, useId, useRef, useState } from "react";
import { CircleAlert, CircleCheck, RotateCcw, Save } from "lucide-react";
import { saveProductPricing } from "@/modules/admin/product-pricing-actions";
import { productPricePreview, productPricingRatesSchema, type ProductPricing, type ProductPricingResult } from "@/modules/admin/product-pricing-schema";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";

const percent = (value: number) => value.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
const money = (value: number) => (value / 100).toLocaleString("tr-TR", { style: "currency", currency: "TRY" });

export function ProductPricingDialog({ id, code, cost, pricing }: { id: string; code: string; cost: number | null; pricing: ProductPricing }) {
  const initialFocus = useRef<HTMLInputElement>(null);
  return <Dialog>
    <DialogTrigger render={<Button variant="outline"/>}>Kâr ve KDV oranları</DialogTrigger>
    <DialogContent initialFocus={initialFocus} className="max-h-5/6 overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Kâr ve KDV oranları</DialogTitle>
        <DialogDescription><span className="break-all font-mono">{code}</span> · Değişiklikler yalnız bu ürüne uygulanır.</DialogDescription>
      </DialogHeader>
      <PricingForm id={id} cost={cost} pricing={pricing} initialFocus={initialFocus}/>
    </DialogContent>
  </Dialog>;
}

function PricingForm({ id, cost, pricing, initialFocus }: { id: string; cost: number | null; pricing: ProductPricing; initialFocus: React.RefObject<HTMLInputElement | null> }) {
  const fieldId = useId();
  const [values, setValues] = useState({ markup: pricing.markup?.toFixed(2) ?? "", vat: pricing.vat?.toFixed(2) ?? "" });
  const [edited, setEdited] = useState(false);
  const [result, action, pending] = useActionState(async (previous: ProductPricingResult, form: FormData): Promise<ProductPricingResult> => {
    const next = await saveProductPricing(previous, form);
    if (next.status === "success" && next.rates) setValues({ markup: next.rates.markup?.toFixed(2) ?? "", vat: next.rates.vat?.toFixed(2) ?? "" });
    setEdited(false);
    return next;
  }, { status: "idle" });
  const parsed = productPricingRatesSchema.safeParse(values);
  const errors = parsed.success ? {} : parsed.error.flatten().fieldErrors;
  const markup = parsed.success ? parsed.data.markup ?? pricing.generalMarkup : pricing.generalMarkup;
  const vat = parsed.success ? parsed.data.vat ?? pricing.generalVat : pricing.generalVat;
  const preview = parsed.success ? productPricePreview(cost, markup, vat) : null;
  const hasCustom = pricing.markup !== null || pricing.vat !== null || values.markup !== "" || values.vat !== "";

  return <form action={action} className="flex min-w-0 flex-col gap-4" onSubmit={event => {
    if ((event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") !== "reset" && !parsed.success) event.preventDefault();
  }}>
    <input type="hidden" name="id" value={id}/>
    <fieldset disabled={pending}><FieldGroup className="grid gap-4 sm:grid-cols-2">
      {(["markup", "vat"] as const).map(field => <Field key={field} data-invalid={Boolean(errors[field])}>
        <FieldLabel htmlFor={`${fieldId}-${field}`}>{field === "markup" ? "Maliyet üzerine kâr (%)" : "KDV oranı (%)"}</FieldLabel>
        <Input ref={field === "markup" ? initialFocus : undefined} id={`${fieldId}-${field}`} name={field} type="text" inputMode="decimal" className="tabular-nums"
          value={values[field]} placeholder={`Genel: %${percent(field === "markup" ? pricing.generalMarkup : pricing.generalVat)}`}
          aria-invalid={Boolean(errors[field])} aria-describedby={`${fieldId}-${field}-hint${errors[field] ? ` ${fieldId}-${field}-error` : ""}`}
          onChange={event => { const value = event.currentTarget.value; setValues(previous => ({ ...previous, [field]: value })); setEdited(true); }}/>
        <FieldDescription id={`${fieldId}-${field}-hint`}>Boş bırakılırsa genel %{percent(field === "markup" ? pricing.generalMarkup : pricing.generalVat)} oranı uygulanır.</FieldDescription>
        {errors[field] && <FieldError id={`${fieldId}-${field}-error`}>{errors[field][0]}</FieldError>}
      </Field>)}
    </FieldGroup></fieldset>
    <Item variant="muted" aria-live="polite" aria-atomic="true">
      <ItemContent>
        <dl className="flex flex-col gap-2">
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">KDV hariç maliyet</dt><dd className="tabular-nums">{cost !== null ? money(Math.round(cost * 100)) : "—"}</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">Uygulanacak oranlar</dt><dd className="tabular-nums">{parsed.success ? `Kâr %${percent(markup)} · KDV %${percent(vat)}` : "—"}</dd></div>
          <Separator/>
          <div className="flex flex-wrap items-center justify-between gap-2"><dt><ItemTitle>Satış fiyatı önizlemesi</ItemTitle></dt><dd className="text-xl font-semibold tabular-nums"><output>{preview !== null ? money(preview) : "—"}</output></dd></div>
        </dl>
        <ItemDescription>KDV dahil. Stok, fiyat güncelliği ve satış teyidi koşulları geçerliliğini korur.</ItemDescription>
      </ItemContent>
    </Item>
    {!edited && result.message && <Alert variant={result.status === "error" ? "destructive" : "default"} role={result.status === "error" ? "alert" : "status"}>
      {result.status === "error" ? <CircleAlert/> : <CircleCheck/>}<AlertDescription>{result.message}</AlertDescription>
    </Alert>}
    <DialogFooter className="sm:justify-between">
      <Button type="submit" name="intent" value="reset" formNoValidate variant="outline" disabled={pending || !hasCustom}><RotateCcw data-icon="inline-start" aria-hidden="true"/>Genel oranlara dön</Button>
      <Button type="submit" name="intent" value="save" disabled={pending || !parsed.success}>{pending ? <Spinner data-icon="inline-start"/> : <Save data-icon="inline-start" aria-hidden="true"/>}{pending ? "Kaydediliyor…" : "Oranları kaydet"}</Button>
    </DialogFooter>
  </form>;
}
