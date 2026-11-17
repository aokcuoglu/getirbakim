"use client";

import { useId, useState } from "react";
import { FileText, Info, Pencil, TriangleAlert } from "lucide-react";
import { manualCost, parseDecimalText } from "@/modules/suppliers/manual-cost";
import { formatExact } from "@/modules/admin/format";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";

/** Where the value in force comes from: a bulk CSV, the item page (also an older panel value), or the upload. */
export type ManualValueSource = "csv" | "panel" | "file" | null;

function SourceBadge({ source }: { source: ManualValueSource }) {
  if (source === "csv") return <Badge variant="info"><Info data-icon="inline-start" aria-hidden="true"/>Toplu CSV</Badge>;
  if (source === "panel") return <Badge variant="info"><Pencil data-icon="inline-start" aria-hidden="true"/>Panelden</Badge>;
  if (source === "file") return <Badge variant="outline"><FileText data-icon="inline-start" aria-hidden="true"/>Dosyadan</Badge>;
  return null;
}

type PriceProblem = { field: "list" | "discount"; message: string } | null;

/** Mirrors readManualPriceEdit (manual-item-form.ts): with no list price a discount of 0 counts as empty. */
function priceProblem(list: number | null | "invalid", discount: number | null | "invalid"): PriceProblem {
  if (list === "invalid") return { field: "list", message: "Liste fiyatı sayı olmalı." };
  if (discount === "invalid") return { field: "discount", message: "İskonto sayı olmalı." };
  if (list === null) return discount === null || discount === 0 ? null : { field: "discount", message: "İskonto liste fiyatı olmadan girilemez." };
  if (list <= 0 || Number(list.toFixed(4)) !== list) return { field: "list", message: "Liste fiyatı sıfırdan büyük olmalı, en fazla dört ondalık." };
  if (discount !== null && discount > 100) return { field: "discount", message: "İskonto 0–100 arasında olmalı." };
  return null;
}

/**
 * List price, discount and stock of a manual list item (#842), inside the item page's form: the cost is previewed as
 * typed. `was_*` sends back the values shown, so the save writes only what the admin changed.
 */
export function ManualPriceFields({ list, discount, stock, priceSource, stockSource, fileNote }: {
  list: string; discount: string; stock: string; priceSource: ManualValueSource; stockSource: ManualValueSource; fileNote?: string;
}) {
  const id = useId();
  const [values, setValues] = useState({ list, discount, stock });
  const parsedList = parseDecimalText(values.list);
  const parsedDiscount = parseDecimalText(values.discount);
    // An untouched value (from the upload or a CSV, which have no decimal limit) is not checked: the save leaves it as is.
  const untouched = values.list === list && values.discount === discount;
  const invalid = priceProblem(parsedList, parsedDiscount);
  const problem = untouched ? null : invalid;
  const cost = !invalid && typeof parsedList === "number" ? manualCost(parsedList, typeof parsedDiscount === "number" ? parsedDiscount : 0) : null;
  const stockProblem = values.stock !== stock && !/^\d*$/.test(values.stock.replace(/\s/g, "")) ? "Stok sıfır ya da pozitif tam sayı olmalı (yalnız rakam)." : null;
  const change = (field: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.currentTarget.value;
    setValues(previous => ({ ...previous, [field]: value }));
  };

  return <div className="flex flex-col gap-4 md:col-span-2">
    <input type="hidden" name="was_listPrice" value={list}/>
    <input type="hidden" name="was_discount" value={discount}/>
    <input type="hidden" name="was_stock" value={stock}/>
    <div className="grid gap-4 lg:grid-cols-3">
      <Field data-invalid={problem?.field === "list"}>
        <FieldLabel htmlFor={`${id}-list`} className="flex-wrap">Liste fiyatı<SourceBadge source={priceSource}/></FieldLabel>
        <Input id={`${id}-list`} name="listPrice" inputMode="decimal" className="tabular-nums" value={values.list} onChange={change("list")}
          aria-invalid={problem?.field === "list"} aria-describedby={`${id}-list-hint${problem ? ` ${id}-price-error` : ""}`}/>
        <FieldDescription id={`${id}-list-hint`}>KDV hariç, TL.</FieldDescription>
      </Field>
      <Field data-invalid={problem?.field === "discount"}>
        <FieldLabel htmlFor={`${id}-discount`}>İskonto oranı</FieldLabel>
        <InputGroup>
          <InputGroupInput id={`${id}-discount`} name="discount" inputMode="decimal" className="tabular-nums" value={values.discount} onChange={change("discount")}
            placeholder="0" aria-invalid={problem?.field === "discount"} aria-describedby={problem ? `${id}-price-error` : undefined}/>
          <InputGroupAddon align="inline-end"><InputGroupText>%</InputGroupText></InputGroupAddon>
        </InputGroup>
      </Field>
      <Field data-invalid={Boolean(stockProblem)}>
        <FieldLabel htmlFor={`${id}-stock`} className="flex-wrap">Stok (adet)<SourceBadge source={stockSource}/></FieldLabel>
        <Input id={`${id}-stock`} name="stock" inputMode="numeric" className="tabular-nums" value={values.stock} onChange={change("stock")}
          aria-invalid={Boolean(stockProblem)} aria-describedby={stockProblem ? `${id}-stock-error` : undefined}/>
        {stockProblem
          ? <FieldError id={`${id}-stock-error`}>{stockProblem}</FieldError>
          : <FieldDescription>Boşsa “stok bilgisi yok” görünür.</FieldDescription>}
      </Field>
    </div>
    {problem && <FieldError id={`${id}-price-error`}>{problem.message}</FieldError>}
    <Item variant="muted" size="sm">
      <ItemContent>
        <ItemTitle>Alış maliyeti (KDV hariç)</ItemTitle>
        <ItemDescription>Liste fiyatı × (1 − iskonto / 100)</ItemDescription>
      </ItemContent>
      <ItemActions>
        <output htmlFor={`${id}-list ${id}-discount`} aria-atomic="true" className="font-semibold tabular-nums">{cost !== null ? `${formatExact(cost)} TL` : values.list.trim() ? "Hesaplanamadı" : "Fiyat yok, satışa kapalı"}</output>
      </ItemActions>
    </Item>
    {cost === 0 && <Alert variant="warning"><TriangleAlert aria-hidden="true"/><AlertDescription>İskonto %100: maliyet 0 olur ve ürün satışa kapanır.</AlertDescription></Alert>}
    <FieldDescription>
      {fileNote && `${fileNote} `}
      Kayıt, sonraki xlsx yüklemesinde dosyadaki hücre değişene kadar geçerli kalır; boş bırakırsanız dosyadaki değere döner.
    </FieldDescription>
  </div>;
}
