"use client";

import { useActionState, useState, type ComponentProps, type ReactNode } from "react";
import { BadgePercent, Calculator, Clock3, Globe2, Info, RotateCcw, Save, Truck } from "lucide-react";
import { savePricing, saveShipping } from "@/modules/admin/commerce-actions";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

type Settings = {
  markup_percent: string; vat_percent: string; max_age_hours: number;
  shipping_fee_kurus: number; free_shipping_threshold_kurus: number;
};
type Currency = { dovizCinsi: string; satis: string };
const tl = (value: number) => value.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = (value: number) => value.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
const decimalPattern = "[0-9]+([.,][0-9]{1,2})?";
const numberRules = {
  markup: { min: 0, max: 1000 },
  vat: { min: 0, max: 100 },
  age: { min: 1, max: 168 },
  cost: { min: 0, max: 1_000_000_000 },
  fee: { min: 0, max: 100000 },
  threshold: { min: 0, max: 10000000 },
};
type NumericField = keyof typeof numberRules;

function numberError(field: NumericField, value: string) {
  if (value === "") return "Bu alan zorunludur.";
  if (!(field === "age" ? /^[0-9]+$/ : /^[0-9]+(?:\.[0-9]{1,2})?$/).test(value)) {
    return field === "age" ? "Tam sayı girin." : "Geçerli bir sayı girin; en fazla iki ondalık basamak kullanın.";
  }
  const { min, max } = numberRules[field];
  if (!Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max) {
    return `${min.toLocaleString("tr-TR")} – ${max.toLocaleString("tr-TR")} arasında bir ${field === "age" ? "tam sayı" : "değer"} girin.`;
  }
}

export function PricingWorkspace({ settings, currencies, children }: { settings: Settings; currencies: Currency[]; children: ReactNode }) {
  const initialFee = (settings.shipping_fee_kurus / 100).toFixed(2);
  const initialThreshold = (settings.free_shipping_threshold_kurus / 100).toFixed(2);
  const [values, setValues] = useState({
    markup: settings.markup_percent, vat: settings.vat_percent, age: String(settings.max_age_hours),
    cost: "100", fee: initialFee, threshold: initialThreshold,
  });
  const { markup, vat, age, cost, fee, threshold } = values;
  const [rejectedInput, setRejectedInput] = useState<Partial<Record<NumericField, string>>>({});
  const [currency, setCurrency] = useState("TRY");
  const errors = {
    markup: rejectedInput.markup ?? numberError("markup", markup),
    vat: rejectedInput.vat ?? numberError("vat", vat),
    age: rejectedInput.age ?? numberError("age", age),
    cost: rejectedInput.cost ?? numberError("cost", cost),
    fee: rejectedInput.fee ?? numberError("fee", fee),
    threshold: rejectedInput.threshold ?? numberError("threshold", threshold),
  };

  function numericInputProps(field: NumericField): ComponentProps<"input"> {
    return {
      type: "text",
      inputMode: field === "age" ? "numeric" : "decimal",
      pattern: field === "age" ? "[0-9]+" : decimalPattern,
      required: true,
      value: values[field],
      "aria-invalid": Boolean(errors[field]),
      "aria-describedby": [field !== "cost" && `${field}-hint`, errors[field] && `${field}-error`].filter(Boolean).join(" ") || undefined,
      onChange: event => {
        const value = event.currentTarget.value.replace(",", ".");
        // Validate the complete proposed value, including paste, drop and mobile input.
        // Keep empty/trailing-decimal drafts editable; final validation explains them.
        if (!(field === "age" ? /^[0-9]*$/ : /^[0-9]*(?:\.[0-9]{0,2})?$/).test(value)) {
          setRejectedInput(previous => ({ ...previous, [field]: field === "age" ? "Yalnızca tam sayı girin." : "Yalnızca sayı girin; en fazla iki ondalık basamak kullanın." }));
          return;
        }
        setValues(previous => ({ ...previous, [field]: value }));
        setRejectedInput(previous => ({ ...previous, [field]: undefined }));
      },
    };
  }

  const [, pricingAction, pricingPending] = useActionState(async (_: null, form: FormData) => { await savePricing(form); return null; }, null);
  const [, shippingAction, shippingPending] = useActionState(async (_: null, form: FormData) => { await saveShipping(form); return null; }, null);
  const pricingChanged = Number(markup) !== Number(settings.markup_percent) || Number(vat) !== Number(settings.vat_percent) || Number(age) !== settings.max_age_hours
    || Boolean(errors.markup || errors.vat || errors.age);
  const shippingChanged = Number(fee) !== Number(initialFee) || Number(threshold) !== Number(initialThreshold) || Boolean(errors.fee || errors.threshold);
  const markupValid = !errors.markup, vatValid = !errors.vat;
  const ratesValid = markupValid && vatValid;
  const pricingValid = ratesValid && !errors.age;
  const shippingValid = !errors.fee && !errors.threshold;
  const exchangeRate = Number(currencies.find(r => r.dovizCinsi === currency)?.satis);
  const previewValid = ratesValid && !errors.cost && Number.isFinite(exchangeRate) && exchangeRate > 0;
  const baseCost = Number(cost) * exchangeRate;
  const profit = baseCost * Number(markup) / 100;
  const tax = (baseCost + profit) * Number(vat) / 100;

  return <div className="flex min-w-0 flex-col gap-6">
    <div className="grid min-w-0 gap-6 xl:grid-cols-2">
      <form className="flex min-w-0" action={pricingAction} onSubmit={event => { if (!pricingValid) event.preventDefault(); }}>
        <Card className="flex-1" role="region" aria-labelledby="pricing-rules-title">
          <CardHeader>
            <CardTitle><h2 id="pricing-rules-title" className="flex items-center gap-2"><BadgePercent className="size-4" aria-hidden="true"/>Satış kuralları</h2></CardTitle>
            <CardDescription>Kâr, vergi ve veri geçerliliğini belirleyin.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1">
            <FieldSet disabled={pricingPending}>
              <FieldGroup>
                <Field data-invalid={Boolean(errors.markup)}>
                  <FieldLabel htmlFor="markup">Maliyet üzerine kâr (%)</FieldLabel>
                  <Input id="markup" name="markup" {...numericInputProps("markup")}/>
                  {errors.markup && <FieldError id="markup-error">{errors.markup}</FieldError>}
                  <FieldDescription id="markup-hint">KDV hariç maliyete eklenir. 0 – 1.000 arasında.</FieldDescription>
                </Field>
                <Field data-invalid={Boolean(errors.vat)}>
                  <FieldLabel htmlFor="vat">KDV oranı (%)</FieldLabel>
                  <Input id="vat" name="vat" {...numericInputProps("vat")}/>
                  {errors.vat && <FieldError id="vat-error">{errors.vat}</FieldError>}
                  <FieldDescription id="vat-hint">Maliyet ve kâr toplamına eklenir. 0 – 100 arasında.</FieldDescription>
                </Field>
                <Field data-invalid={Boolean(errors.age)}>
                  <FieldLabel htmlFor="age">Veri geçerliliği (saat)</FieldLabel>
                  <Input id="age" name="age" {...numericInputProps("age")}/>
                  {errors.age && <FieldError id="age-error">{errors.age}</FieldError>}
                  <FieldDescription id="age-hint">Canlı doğrulamada kur ve ürün verisi için. 1 – 168 saat arasında.</FieldDescription>
                </Field>
              </FieldGroup>
            </FieldSet>
          </CardContent>
          <CardFooter className="flex flex-wrap justify-between gap-3">
            <Badge variant="secondary" role="status">{!pricingValid ? "Alanları kontrol edin" : pricingChanged ? "Kaydedilmemiş değişiklikler" : "Kayıtlı ayarlar"}</Badge>
            <Field orientation="horizontal" className="w-auto flex-wrap">
              {pricingChanged && <Button type="button" variant="outline" disabled={pricingPending} onClick={() => { setValues(previous => ({ ...previous, markup: settings.markup_percent, vat: settings.vat_percent, age: String(settings.max_age_hours) })); setRejectedInput(previous => ({ ...previous, markup: undefined, vat: undefined, age: undefined })); }} aria-label="Değişiklikleri geri al"><RotateCcw aria-hidden="true"/>Geri al</Button>}
              <Button type="submit" disabled={!pricingChanged || !pricingValid || pricingPending}>{pricingPending ? <Spinner aria-label="Kaydediliyor"/> : <Save aria-hidden="true"/>}{pricingPending ? "Kaydediliyor…" : "Kuralları kaydet"}</Button>
            </Field>
          </CardFooter>
        </Card>
      </form>

      <Card className="min-w-0" role="region" aria-labelledby="price-preview-title">
        <CardHeader>
          <CardTitle><h2 id="price-preview-title" className="flex items-center gap-2"><Calculator className="size-4" aria-hidden="true"/>Fiyat önizlemesi</h2></CardTitle>
          <CardDescription>Oranların etkisini görün. Servis indirimi ve kargo hariç.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-6">
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={Boolean(errors.cost)}>
              <FieldLabel htmlFor="preview-cost">Ürün maliyeti (NF · {currency === "TRY" ? "TL" : currency})</FieldLabel>
              <Input id="preview-cost" {...numericInputProps("cost")}/>
              {errors.cost && <FieldError id="cost-error">{errors.cost}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="preview-currency">Para birimi</FieldLabel>
              <NativeSelect id="preview-currency" value={currency} onChange={event => setCurrency(event.target.value)}>
                {currencies.filter(r => Number.isFinite(Number(r.satis)) && Number(r.satis) > 0).map(r => <NativeSelectOption key={r.dovizCinsi} value={r.dovizCinsi}>{r.dovizCinsi === "TRY" ? "TRY · TL" : r.dovizCinsi}</NativeSelectOption>)}
              </NativeSelect>
            </Field>
          </FieldGroup>
          <div>
            <Table aria-label="Fiyat hesaplama adımları">
              <TableBody>
                <TableRow><TableCell className="whitespace-normal">TL maliyeti</TableCell><TableCell className="text-right tabular-nums">{previewValid ? `${tl(baseCost)} TL` : "—"}</TableCell></TableRow>
                <TableRow><TableCell className="whitespace-normal">Kâr eklemesi (%{markupValid ? percent(Number(markup)) : "—"})</TableCell><TableCell className="text-right tabular-nums">{previewValid ? `+${tl(profit)} TL` : "—"}</TableCell></TableRow>
                <TableRow><TableCell className="whitespace-normal">KDV (%{vatValid ? percent(Number(vat)) : "—"})</TableCell><TableCell className="text-right tabular-nums">{previewValid ? `+${tl(tax)} TL` : "—"}</TableCell></TableRow>
              </TableBody>
            </Table>
            {currency !== "TRY" && <FieldDescription className="mt-2">1 {currency} = {exchangeRate.toLocaleString("tr-TR", { minimumFractionDigits: 4, maximumFractionDigits: 4 })} TL</FieldDescription>}
          </div>
          <Item variant="muted" className="mt-auto" role="status" aria-live="polite" aria-atomic="true">
            <ItemContent>
              <ItemTitle>KDV dahil satış fiyatı</ItemTitle>
              <CardTitle className="text-3xl tabular-nums break-all">{previewValid ? `${tl(baseCost + profit + tax)} TL` : "—"}</CardTitle>
              <ItemDescription>{!previewValid ? "Önizleme için geçerli maliyet ve oranlar girin." : pricingChanged ? "Kaydedilmemiş oranlarla hesaplandı." : "Kayıtlı oranlarla hesaplandı."}</ItemDescription>
            </ItemContent>
          </Item>
        </CardContent>
      </Card>
    </div>

    <form action={shippingAction} onSubmit={event => { if (!shippingValid) event.preventDefault(); }}>
        <Card role="region" aria-labelledby="shipping-rules-title">
          <CardHeader>
            <CardTitle><h2 id="shipping-rules-title" className="flex items-center gap-2"><Truck className="size-4" aria-hidden="true"/>Kargo kuralları</h2></CardTitle>
            <CardDescription>Kargo ücreti ödeme sırasında sipariş toplamına eklenir.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldSet disabled={shippingPending}>
              <FieldGroup className="grid gap-6 sm:grid-cols-2">
                <Field data-invalid={Boolean(errors.fee)}>
                  <FieldLabel htmlFor="fee">Kargo ücreti (TL)</FieldLabel>
                  <Input id="fee" name="fee" {...numericInputProps("fee")}/>
                  {errors.fee && <FieldError id="fee-error">{errors.fee}</FieldError>}
                  <FieldDescription id="fee-hint">KDV dahil sabit ücret. 0 girildiğinde kargo ücretsizdir.</FieldDescription>
                </Field>
                <Field data-invalid={Boolean(errors.threshold)}>
                  <FieldLabel htmlFor="threshold">Ücretsiz kargo eşiği (TL)</FieldLabel>
                  <Input id="threshold" name="threshold" {...numericInputProps("threshold")}/>
                  {errors.threshold && <FieldError id="threshold-error">{errors.threshold}</FieldError>}
                  <FieldDescription id="threshold-hint">İndirim sonrası ürün toplamı için. 0 girildiğinde eşik uygulanmaz.</FieldDescription>
                </Field>
              </FieldGroup>
            </FieldSet>
            <Item variant="muted" className="mt-4" role="status"><ItemContent><ItemDescription>{!shippingValid ? "Kargo özeti için geçerli tutarlar girin." : Number(fee) === 0 ? "Tüm siparişlerde ücretsiz kargo." : Number(threshold) > 0 ? `${tl(Number(threshold))} TL ve üzeri ücretsiz; diğer siparişlerde ${tl(Number(fee))} TL.` : `Tüm siparişlerde ${tl(Number(fee))} TL kargo ücreti.`}</ItemDescription></ItemContent></Item>
          </CardContent>
          <CardFooter className="flex flex-wrap justify-between gap-3">
            <Badge variant="secondary" role="status">{!shippingValid ? "Alanları kontrol edin" : shippingChanged ? "Kaydedilmemiş değişiklikler" : "Kayıtlı ayarlar"}</Badge>
            <Field orientation="horizontal" className="w-auto flex-wrap">
              {shippingChanged && <Button type="button" variant="outline" disabled={shippingPending} onClick={() => { setValues(previous => ({ ...previous, fee: initialFee, threshold: initialThreshold })); setRejectedInput(previous => ({ ...previous, fee: undefined, threshold: undefined })); }} aria-label="Değişiklikleri geri al"><RotateCcw aria-hidden="true"/>Geri al</Button>}
              <Button type="submit" disabled={!shippingChanged || !shippingValid || shippingPending}>{shippingPending ? <Spinner aria-label="Kaydediliyor"/> : <Save aria-hidden="true"/>}{shippingPending ? "Kaydediliyor…" : "Kargoyu kaydet"}</Button>
            </Field>
          </CardFooter>
        </Card>
    </form>

    <Card role="region" aria-label="Fiyatlandırma açıklamaları">
      <CardContent>
        <Accordion>
          <AccordionItem value="currency-rates">
            <AccordionTrigger><span className="flex items-center gap-2"><Globe2 className="size-4" aria-hidden="true"/>Döviz satış kurları</span></AccordionTrigger>
            <AccordionContent>{children}</AccordionContent>
          </AccordionItem>
          <AccordionItem value="calculation">
            <AccordionTrigger><span className="flex items-center gap-2"><Info className="size-4" aria-hidden="true"/>Fiyat nasıl hesaplanır?</span></AccordionTrigger>
            <AccordionContent>
              <p>Başbuğ NF tutarı KDV hariç ürün maliyetidir. Dövizli maliyet önce TL’ye çevrilir, ardından kâr ve KDV eklenir.</p>
              <p>NF × döviz satış kuru × (1 + kâr / 100) × (1 + KDV / 100)</p>
              <p>Servis indirimi bu satış fiyatı üzerinden uygulanır. Kargo, sipariş toplamına ayrıca eklenir.</p>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="data-validity">
            <AccordionTrigger><span className="flex items-center gap-2"><Clock3 className="size-4" aria-hidden="true"/>Veri geçerliliği nasıl çalışır?</span></AccordionTrigger>
            <AccordionContent>
              <p>Canlı doğrulama modunda süresi geçen kur veya ürün verisi satışa kapatılır. Kayıtlı veri modunda son fiyat, stok ve kur kullanılır; sipariş fiyat ve stok teyidi bekler.</p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  </div>;
}
