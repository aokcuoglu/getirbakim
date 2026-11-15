"use client";

import { startTransition, useActionState, useId, useReducer, useState } from "react";
import { Calculator, CircleAlert, CircleCheck, Info, Pencil, RotateCcw, Save, TriangleAlert } from "lucide-react";
import { saveProductPrice } from "@/app/yonetim/urunler/actions";
import { belowCost, campaignTimeText, costWithVat, priceText, productOverrideLabels, type ProductPriceResult, type ProductPriceValues } from "@/modules/admin/product-override-fields";
import { productPriceValuesSchema } from "@/modules/admin/product-override-schema";
import { initialPriceForm, priceFormReducer, type PriceFormValues } from "@/modules/admin/product-price-form-state";
import { UnsavedInputGuard } from "@/components/admin/unsaved-input-guard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";

/** A saleable source: its formula price (null: the formula cannot price it, so neither can a fixed price) and cost. */
export type PriceFormSource = { id: string; code: string; available: boolean; auto: number | null; cost: number | null; vat: number | null };

type Parsed = Pick<ProductPriceValues, "price_kurus" | "sale_price_kurus" | "sale_from" | "sale_until">;

/** The catalog's rule (db/commerce.sql) for one source: the campaign inside its window and below the regular price. */
function effective(auto: number | null, values: Parsed, now: string) {
  if (auto === null) return null;
  const regular = values.price_kurus ?? auto;
  const running = values.sale_price_kurus !== null && (values.sale_from === null || values.sale_from <= now)
    && (values.sale_until === null || now < values.sale_until);
  return running && values.sale_price_kurus! < regular ? values.sale_price_kurus! : regular;
}

/**
 * The product's fixed price and campaign (#580), VAT included. Inputs are controlled by priceFormReducer like the store
 * card form: a save shows what was stored, a revert resets its own inputs only, an error keeps the input. `now` is the
 * page's render time as Istanbul wall clock, so the preview matches the server's rendering. Leaving the tab with unsaved input asks first (#698).
 */
export function ProductPriceForm({ productId, values, version, sources, now }: {
  productId: string; values: ProductPriceValues | null; version: string; sources: PriceFormSource[]; now: string;
}) {
  const fieldId = useId();
  const [form, dispatch] = useReducer(priceFormReducer, null, () => initialPriceForm(values, version));
  const [pageVersion, setPageVersion] = useState(version);
  if (pageVersion !== version) {
    setPageVersion(version);
    dispatch({ type: "server", values, version });
  }
  const [showResult, setShowResult] = useState(false);
  const [result, action, pending] = useActionState(async (previous: ProductPriceResult, data: FormData): Promise<ProductPriceResult> => {
    const next = await saveProductPrice(previous, data);
    dispatch({ type: "result", result: next });
    setShowResult(true);
    return next;
  }, { status: "idle" });
  const edit = (change: Partial<PriceFormValues>) => { dispatch({ type: "edit", values: change }); setShowResult(false); };
  // Errors show for fields the admin has left (blur) or after a save attempt, not on every keystroke.
  const [touched, setTouched] = useState<(keyof PriceFormValues)[]>([]);
  const touch = (field: keyof PriceFormValues) => setTouched(previous => previous.includes(field) ? previous : [...previous, field]);
  const submit = (reset?: "price_kurus" | "sale_price_kurus") => {
    const data = new FormData();
    data.set("id", productId);
    data.set("version", form.version);
    if (reset) data.set("reset", reset);
    else for (const field of ["price", "sale_price", "sale_from", "sale_until"] as const) data.set(field, form.values[field]);
    startTransition(() => action(data));
  };

  const parsed = productPriceValuesSchema.safeParse(form.values);
  const allErrors: Partial<Record<keyof PriceFormValues, string[]>> = parsed.success ? {} : { ...parsed.error.flatten().fieldErrors };
  // A new end at or before the page's time (both Istanbul wall clock, the same text the schema checks) would be
  // refused by the save; an unchanged ended campaign is not (it no longer applies). The server decides with now().
  const until = form.values.sale_until.trim();
  if (!allErrors.sale_until && until && until !== (values?.sale_until ?? "") && until <= now) allErrors.sale_until = ["Kampanya bitişi geçmişte kalıyor; ileri bir tarih seçin."];
  const valid = parsed.success && !allErrors.sale_until;
  const errors = Object.fromEntries(touched.filter(field => allErrors[field]).map(field => [field, allErrors[field]])) as typeof allErrors;
  // The preview follows valid input only: with an invalid field it shows no effective price instead of a stale one.
  const shown: Parsed | null = valid && parsed.success ? parsed.data : null;
  const priced = sources.filter(source => source.auto !== null).map(source => ({ ...source, price: shown ? effective(source.auto, shown, now)! : source.auto! }));
  // The source the store sells: available first, then cheapest, then the lower cost (compareOffers).
  const selling = [...priced].sort((a, b) => Number(b.available) - Number(a.available) || a.price - b.price || (a.cost ?? Infinity) - (b.cost ?? Infinity))[0];
  const costs = sources.map(source => costWithVat(source.cost, source.vat)).filter((cost): cost is number => cost !== null);
  const lowestCost = costs.length ? Math.min(...costs) : null;
  const below = shown ? priced.filter(source => belowCost(source.price, source.cost, source.vat)) : [];
  const fixed = values?.price_kurus != null, campaign = values?.sale_price_kurus != null;
  // A stored campaign whose end has passed no longer applies; saved prices beside it are still accepted.
  const ended = campaign && values?.sale_until != null && values.sale_until <= now ? values.sale_until : null;
  const id = (field: keyof PriceFormValues) => `${fieldId}-${field}`;
  const describedBy = (field: keyof PriceFormValues) => `${id(field)}-hint${errors[field] ? ` ${id(field)}-error` : ""}`;
  const state = (set: boolean, reset: "price_kurus" | "sale_price_kurus", label: string) => <div className="flex flex-wrap items-center gap-2">
    {set ? <Badge variant="info"><Pencil data-icon="inline-start" aria-hidden="true"/>Elle</Badge> : <Badge variant="outline"><Calculator data-icon="inline-start" aria-hidden="true"/>Otomatik</Badge>}
    {set && <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => submit(reset)}>
      <RotateCcw data-icon="inline-start" aria-hidden="true"/>{reset === "price_kurus" ? "Otomatiğe dön" : "Kampanyayı kaldır"}<span className="sr-only"> ({label})</span>
    </Button>}
  </div>;
  const money = (field: "price" | "sale_price", placeholder: string) => <InputGroup>
    <InputGroupInput id={id(field)} name={field} inputMode="decimal" autoComplete="off" className="tabular-nums" value={form.values[field]} placeholder={placeholder}
      aria-invalid={Boolean(errors[field])} aria-describedby={describedBy(field)} onChange={event => edit({ [field]: event.currentTarget.value })}
      onBlur={() => touch(field)}/>
    <InputGroupAddon align="inline-end"><InputGroupText>₺</InputGroupText></InputGroupAddon>
  </InputGroup>;
  const time = (field: "sale_from" | "sale_until") => <Input id={id(field)} name={field} type="datetime-local" className="tabular-nums" value={form.values[field]}
    aria-invalid={Boolean(errors[field])} aria-describedby={describedBy(field)} onChange={event => edit({ [field]: event.currentTarget.value })}
    onBlur={() => touch(field)}/>;
  const error = (field: keyof PriceFormValues) => errors[field] && <FieldError id={`${id(field)}-error`}>{errors[field][0]}</FieldError>;

  return <>
    <form className="flex flex-col gap-6" onSubmit={event => {
      event.preventDefault();
      if (valid) submit(); else setTouched(["price", "sale_price", "sale_from", "sale_until"]);
    }}>
      <fieldset disabled={pending}>
        <FieldGroup className="grid gap-6 md:grid-cols-2">
          <Field data-invalid={Boolean(errors.price)} className="md:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <FieldLabel htmlFor={id("price")}>{productOverrideLabels.price_kurus}</FieldLabel>
              {state(fixed, "price_kurus", productOverrideLabels.price_kurus)}
            </div>
            {money("price", selling?.auto != null ? `Formül: ${priceText(selling.auto)}` : "Formül fiyatı yok")}
            <FieldDescription id={`${id("price")}-hint`}>KDV dahil; boş bırakılırsa formül uygulanır, oranlar kaynak satırındaki “Kâr ve KDV oranları” penceresinden yönetilir.</FieldDescription>
            {error("price")}
          </Field>
          <Field data-invalid={Boolean(errors.sale_price)} className="md:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <FieldLabel htmlFor={id("sale_price")}>{productOverrideLabels.sale_price_kurus}</FieldLabel>
              {state(campaign, "sale_price_kurus", productOverrideLabels.sale_price_kurus)}
            </div>
            {money("sale_price", "Kampanya yok")}
            <FieldDescription id={`${id("sale_price")}-hint`}>KDV dahil. Mağazada normal fiyat üstü çizili gösterilir. Normal fiyattan düşük değilse uygulanmaz.</FieldDescription>
            {error("sale_price")}
          </Field>
          <Field data-invalid={Boolean(errors.sale_from)}>
            <FieldLabel htmlFor={id("sale_from")}>{productOverrideLabels.sale_from}</FieldLabel>
            {time("sale_from")}
            <FieldDescription id={`${id("sale_from")}-hint`}>İstanbul saati. Boş bırakılırsa kayıttan itibaren başlar.</FieldDescription>
            {error("sale_from")}
          </Field>
          <Field data-invalid={Boolean(errors.sale_until)}>
            <FieldLabel htmlFor={id("sale_until")}>{productOverrideLabels.sale_until}</FieldLabel>
            {time("sale_until")}
            <FieldDescription id={`${id("sale_until")}-hint`}>İstanbul saati. Boş bırakılırsa kampanya kaldırılana kadar sürer.</FieldDescription>
            {error("sale_until")}
          </Field>
        </FieldGroup>
      </fieldset>
      {ended && <Alert variant="info"><Info aria-hidden="true"/><AlertTitle>Kampanya sona erdi</AlertTitle>
        <AlertDescription>{campaignTimeText(ended)} (İstanbul) itibarıyla uygulanmıyor. Kaldırabilir ya da yeni bir bitiş girebilirsiniz.</AlertDescription></Alert>}
      <Item variant="muted">
        <ItemContent>
          <dl className="flex flex-col gap-2">
            <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">Otomatik fiyat (formül)</dt><dd className="tabular-nums">{selling?.auto != null ? priceText(selling.auto) : "—"}</dd></div>
            <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">En düşük KDV dahil maliyet</dt><dd className="tabular-nums">{lowestCost !== null ? priceText(lowestCost) : "—"}</dd></div>
            <Separator/>
            <div className="flex flex-wrap items-center justify-between gap-2"><dt><ItemTitle>Mağazada etkili fiyat</ItemTitle></dt>
              <dd className="text-xl font-semibold tabular-nums"><output aria-live="polite">{!shown ? <>—<span className="sr-only"> (geçersiz alanları düzeltin)</span></> : selling ? priceText(selling.price) : "—"}</output></dd></div>
          </dl>
          <ItemDescription>{shown ? "KDV dahil, satılan kaynak için. Servis (B2B) indirimi bu fiyatın üzerine uygulanır." : "Geçersiz alanları düzeltin; etkili fiyat ona göre hesaplanır."}</ItemDescription>
        </ItemContent>
      </Item>
      {!priced.length && <Alert variant="warning"><TriangleAlert aria-hidden="true"/><AlertTitle>Formül fiyatı yok</AlertTitle>
        <AlertDescription>Tedarikçi maliyeti, kuru veya güncelliği eksik. Girilen fiyat ürünü satışa açmaz; tedarikçi verisi gelince uygulanır.</AlertDescription></Alert>}
      {below.length > 0 && <Alert variant="warning" role="status"><TriangleAlert aria-hidden="true"/><AlertTitle>Maliyet altı</AlertTitle>
        <AlertDescription>Bu fiyat şu kaynakların KDV dahil maliyetinin altında: {below.map(source => source.code).join(", ")}. Kayıt engellenmez; zararına satış olmaması için kontrol edin.</AlertDescription></Alert>}
      {showResult && result.message && <Alert variant={result.status === "error" ? "destructive" : "success"} role={result.status === "error" ? "alert" : "status"}>
        {result.status === "error" ? <CircleAlert aria-hidden="true"/> : <CircleCheck aria-hidden="true"/>}<AlertDescription>{result.message}</AlertDescription>
      </Alert>}
      {showResult && result.warning && <Alert variant="warning" role="status"><TriangleAlert aria-hidden="true"/><AlertDescription>{result.warning}</AlertDescription></Alert>}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>{pending ? <Spinner data-icon="inline-start" aria-hidden="true"/> : <Save data-icon="inline-start" aria-hidden="true"/>}{pending ? "Kaydediliyor…" : "Fiyatı kaydet"}</Button>
      </div>
    </form>
  <UnsavedInputGuard dirty={form.dirty.length > 0}/>
  </>;
}
