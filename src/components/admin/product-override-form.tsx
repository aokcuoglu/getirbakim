"use client";

import { startTransition, useActionState, useId, useReducer, useState } from "react";
import { CircleAlert, CircleCheck, Pencil, RotateCcw, Save } from "lucide-react";
import { saveProductOverride } from "@/app/yonetim/urunler/actions";
import { productOverrideLabels, type ProductCardField, type ProductCardValues, type ProductOverrideResult } from "@/modules/admin/product-override-fields";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { initialOverrideForm, overrideFormReducer, type OverrideFormValues } from "@/modules/admin/product-override-form-state";
import { CategoryCombobox, type CategoryOption } from "./category-combobox";

const excerpt = (text: string, length = 160) => text.length > length ? `${text.slice(0, length).trimEnd()}…` : text;

/**
 * The store card fields an admin sets by hand (#575). An empty field follows the automatic sources; "Otomatiğe dön"
 * clears one field and leaves the other fields' unsaved input alone. Every input is controlled by
 * overrideFormReducer: after a save or revert the form shows what the action stored, an error keeps the input as typed.
 * `version` is the stored edit the form was opened with: the action refuses a save made on top of a newer one.
 */
export function ProductOverrideForm({ productId, values, version, automatic, categories }: {
  productId: string;
  values: ProductCardValues | null;
  version: string;
  /** `category` is null when the enrichment gives the product no category. */
  automatic: { name: string; description: string; category: string | null };
  categories: CategoryOption[];
}) {
  const fieldId = useId();
  const [form, dispatch] = useReducer(overrideFormReducer, null, () => initialOverrideForm(values, version));
  // A render with another stored version (a refresh after a save elsewhere) is adopted; our own save's refresh is not news.
  const [pageVersion, setPageVersion] = useState(version);
  if (pageVersion !== version) {
    setPageVersion(version);
    dispatch({ type: "server", values, version });
  }
  const [showResult, setShowResult] = useState(false);
  const [result, action, pending] = useActionState(async (previous: ProductOverrideResult, data: FormData): Promise<ProductOverrideResult> => {
    const next = await saveProductOverride(previous, data);
    dispatch({ type: "result", result: next });
    setShowResult(true);
    return next;
  }, { status: "idle" });
  const edit = (change: Partial<OverrideFormValues>) => { dispatch({ type: "edit", values: change }); setShowResult(false); };
  const current = values ?? { name: null, description: null, seo_title: null, seo_description: null, category_id: null, hidden: false };
  const overridden = (field: ProductCardField) => field === "hidden" ? current.hidden : current[field] !== null;
  // Submitted from state (not the DOM form), so React's reset of a form action never touches what the admin typed.
  const submit = (reset?: ProductCardField) => {
    const data = new FormData();
    data.set("id", productId);
    data.set("version", form.version);
    if (reset) data.set("reset", reset);
    else {
      for (const field of ["name", "description", "seo_title", "seo_description", "category_id"] as const) data.set(field, form.values[field]);
      if (form.values.published) data.set("published", "on");
    }
    startTransition(() => action(data));
  };
  const label = (field: ProductCardField, htmlFor: string, title = productOverrideLabels[field]) => <div className="flex flex-wrap items-center justify-between gap-2">
    <div className="flex flex-wrap items-center gap-2">
      <FieldLabel htmlFor={htmlFor}>{title}</FieldLabel>
      {overridden(field) ? <Badge variant="info"><Pencil data-icon="inline-start" aria-hidden="true"/>Elle</Badge> : <Badge variant="outline">Otomatik</Badge>}
    </div>
    {overridden(field) && <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => submit(field)}>
      <RotateCcw data-icon="inline-start" aria-hidden="true"/>Otomatiğe dön<span className="sr-only"> ({productOverrideLabels[field]})</span>
    </Button>}
  </div>;
  const id = (field: ProductCardField) => `${fieldId}-${field}`;
  const textInput = (field: "name" | "seo_title") => ({
    id: id(field), name: field, value: form.values[field], "aria-describedby": `${id(field)}-hint`,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => edit({ [field]: event.currentTarget.value }),
  });
  const textArea = (field: "description" | "seo_description") => ({
    id: id(field), name: field, value: form.values[field], "aria-describedby": `${id(field)}-hint`,
    onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => edit({ [field]: event.currentTarget.value }),
  });

  return <form className="flex flex-col gap-6" onSubmit={event => { event.preventDefault(); submit(); }}>
    <fieldset disabled={pending}>
      <FieldGroup className="grid gap-6 md:grid-cols-2">
        <Field>
          {label("name", id("name"))}
          <Input {...textInput("name")} maxLength={300} placeholder={automatic.name}/>
          <FieldDescription id={`${id("name")}-hint`}>Boş bırakılırsa: {automatic.name}</FieldDescription>
        </Field>
        <Field>
          {label("category_id", id("category_id"))}
          <CategoryCombobox id={id("category_id")} name="category_id" placeholder="Kategori ara" options={categories}
            value={form.values.category_id} onValueChange={value => edit({ category_id: value })} describedBy={`${id("category_id")}-hint`}/>
          <FieldDescription id={`${id("category_id")}-hint`}>{automatic.category ? `Boş bırakılırsa: ${automatic.category}` : "Otomatik kategori yok; boş bırakılırsa kategori atanmaz."}</FieldDescription>
        </Field>
        <Field className="md:col-span-2">
          {label("description", id("description"))}
          <Textarea {...textArea("description")} rows={6} maxLength={5000}/>
          <FieldDescription id={`${id("description")}-hint`}>Boş bırakılırsa: {automatic.description ? excerpt(automatic.description) : "Tedarikçi açıklaması yok."}</FieldDescription>
        </Field>
        <Field orientation="horizontal" className="md:col-span-2">
          <Switch id={id("hidden")} name="published" checked={form.values.published} onCheckedChange={checked => edit({ published: checked })}
            aria-describedby={`${id("hidden")}-hint`}/>
          <FieldContent>
            {label("hidden", id("hidden"), "Mağazada yayında")}
            <FieldDescription id={`${id("hidden")}-hint`}>Otomatik: yayında. Kapalıyken ürün mağazada, sepette, bayi API&apos;sinde ve bakım setlerinde görünmez; satışa kapanır.</FieldDescription>
          </FieldContent>
        </Field>
        <Field>
          {label("seo_title", id("seo_title"))}
          <Input {...textInput("seo_title")} maxLength={120}/>
          <FieldDescription id={`${id("seo_title")}-hint`}>Boş bırakılırsa marka, ürün adı ve koddan oluşturulur.</FieldDescription>
        </Field>
        <Field>
          {label("seo_description", id("seo_description"))}
          <Textarea {...textArea("seo_description")} rows={3} maxLength={300}/>
          <FieldDescription id={`${id("seo_description")}-hint`}>Boş bırakılırsa ürün açıklamasından oluşturulur.</FieldDescription>
        </Field>
      </FieldGroup>
    </fieldset>
    <p className="text-muted-foreground">Liste sayımları ve kategori sayfaları en geç 10 dakika içinde güncellenir.</p>
    {showResult && result.message && <Alert variant={result.status === "error" ? "destructive" : "success"} role={result.status === "error" ? "alert" : "status"}>
      {result.status === "error" ? <CircleAlert aria-hidden="true"/> : <CircleCheck aria-hidden="true"/>}<AlertDescription>{result.message}</AlertDescription>
    </Alert>}
    <div className="flex justify-end">
      <Button type="submit" disabled={pending}>{pending ? <Spinner data-icon="inline-start" aria-hidden="true"/> : <Save data-icon="inline-start" aria-hidden="true"/>}{pending ? "Kaydediliyor…" : "Kaydet"}</Button>
    </div>
  </form>;
}
