"use client";

import { useId, useState } from "react";
import { FileText, Info, TriangleAlert } from "lucide-react";
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
  if (source === "panel") return <Badge variant="info"><Info data-icon="inline-start" aria-hidden="true"/>Panelden</Badge>;
  if (source === "file") return <Badge variant="outline"><FileText data-icon="inline-start" aria-hidden="true"/>Dosyadan</Badge>;
  return null;
}

function priceProblem(list: number | null | "invalid", discount: number | null | "invalid") {
  if (list === "invalid" || discount === "invalid") return "Liste fiyatı ve iskonto sayı olmalı.";
  if (list === null) return discount === null ? null : "İskonto liste fiyatı olmadan girilemez.";
  if (list <= 0 || Number(list.toFixed(4)) !== list) return "Liste fiyatı sıfırdan büyük olmalı (en fazla dört ondalık).";
  if (discount !== null && discount > 100) return "İskonto 0–100 arasında olmalı.";
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
  const parsedStock = parseDecimalText(values.stock);
  const problem = priceProblem(parsedList, parsedDiscount);
  const cost = !problem && typeof parsedList === "number" ? manualCost(parsedList, typeof parsedDiscount === "number" ? parsedDiscount : 0) : null;
  const stockProblem = parsedStock === "invalid" || typeof parsedStock === "number" && !Number.isInteger(parsedStock)
    ? "Stok sıfır ya da pozitif tam sayı olmalı." : null;
  const change = (field: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.currentTarget.value;
    setValues(previous => ({ ...previous, [field]: value }));
  };

  return <div className="flex flex-col gap-4 md:col-span-2">
    <input type="hidden" name="was_listPrice" value={list}/>
    <input type="hidden" name="was_discount" value={discount}/>
    <input type="hidden" name="was_stock" value={stock}/>
    <div className="grid gap-4 md:grid-cols-3">
      <Field data-invalid={Boolean(problem)}>
        <FieldLabel htmlFor={`${id}-list`}>Liste fiyatı (KDV hariç, TL)<SourceBadge source={priceSource}/></FieldLabel>
        <Input id={`${id}-list`} name="listPrice" inputMode="decimal" className="tabular-nums" value={values.list} onChange={change("list")}
          aria-invalid={Boolean(problem)} aria-describedby={problem ? `${id}-price-error` : undefined}/>
      </Field>
      <Field data-invalid={Boolean(problem)}>
        <FieldLabel htmlFor={`${id}-discount`}>İskonto oranı</FieldLabel>
        <InputGroup>
          <InputGroupInput id={`${id}-discount`} name="discount" inputMode="decimal" className="tabular-nums" value={values.discount} onChange={change("discount")}
            placeholder="0" aria-invalid={Boolean(problem)} aria-describedby={problem ? `${id}-price-error` : undefined}/>
          <InputGroupAddon align="inline-end"><InputGroupText>%</InputGroupText></InputGroupAddon>
        </InputGroup>
      </Field>
      <Field data-invalid={Boolean(stockProblem)}>
        <FieldLabel htmlFor={`${id}-stock`}>Stok (adet)<SourceBadge source={stockSource}/></FieldLabel>
        <Input id={`${id}-stock`} name="stock" inputMode="numeric" className="tabular-nums" value={values.stock} onChange={change("stock")}
          aria-invalid={Boolean(stockProblem)} aria-describedby={stockProblem ? `${id}-stock-error` : undefined}/>
        {stockProblem
          ? <FieldError id={`${id}-stock-error`}>{stockProblem}</FieldError>
          : <FieldDescription>Boşsa “stok bilgisi yok” görünür.</FieldDescription>}
      </Field>
    </div>
    {problem && <FieldError id={`${id}-price-error`}>{problem}</FieldError>}
    <Item variant="muted" size="sm">
      <ItemContent>
        <ItemTitle>Alış maliyeti (KDV hariç)</ItemTitle>
        <ItemDescription>Liste fiyatı × (1 − iskonto / 100)</ItemDescription>
      </ItemContent>
      <ItemActions>
        <output aria-live="polite" className="font-semibold tabular-nums">{cost !== null ? `${formatExact(cost)} TL` : values.list.trim() ? "—" : "Fiyat yok, satışa kapalı"}</output>
      </ItemActions>
    </Item>
    {cost === 0 && <Alert variant="warning"><TriangleAlert aria-hidden="true"/><AlertDescription>İskonto %100: maliyet 0 olur ve ürün satışa kapanır.</AlertDescription></Alert>}
    <FieldDescription>
      {fileNote && `${fileNote} `}
      Kayıt, sonraki xlsx yüklemesinde dosyadaki hücre değişene kadar geçerli kalır; boş bırakırsanız dosyadaki değere döner.
    </FieldDescription>
  </div>;
}
