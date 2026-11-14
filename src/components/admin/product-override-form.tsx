"use client";

import { startTransition, useActionState, useId, useState } from "react";
import { CircleAlert, CircleCheck, Pencil, RotateCcw, Save } from "lucide-react";
import { saveProductOverride } from "@/app/yonetim/urunler/actions";
import { productOverrideLabels, type ProductOverrideField, type ProductOverrideResult, type ProductOverrideValues } from "@/modules/admin/product-override-fields";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CategoryCombobox, type CategoryOption } from "./category-combobox";

const excerpt = (text: string, length = 160) => text.length > length ? `${text.slice(0, length).trimEnd()}…` : text;

/**
 * The store card fields an admin sets by hand (#575). An empty field follows the automatic sources; "Otomatiğe dön"
 * clears one field and leaves the other fields' unsaved input alone. `version` is the stored edit the form was opened
 * with: the action refuses a save made on top of a newer one.
 */
export function ProductOverrideForm({ productId, values, version, automatic, categories }: {
  productId: string;
  values: ProductOverrideValues | null;
  version: string;
  /** `category` is null when the enrichment gives the product no category. */
  automatic: { name: string; description: string; category: string | null };
  categories: CategoryOption[];
}) {
  const fieldId = useId();
  // A full save remounts the inputs with the stored values; a reset clears only its own field.
  const [saved, setSaved] = useState(0);
  const [cleared, setCleared] = useState<ProductOverrideField[]>([]);
  const [showResult, setShowResult] = useState(false);
  const [result, action, pending] = useActionState(async (previous: ProductOverrideResult, form: FormData): Promise<ProductOverrideResult> => {
    const next = await saveProductOverride(previous, form);
    if (next.status === "success") {
      const reset = next.reset;
      if (reset) setCleared(fields => [...fields, reset]);
      else { setCleared([]); setSaved(count => count + 1); }
    }
    setShowResult(true);
    return next;
  }, { status: "idle" });
  const edited = () => setShowResult(false);
  const current = values ?? { name: null, description: null, seo_title: null, seo_description: null, category_id: null, hidden: false };
  const overridden = (field: ProductOverrideField) => field === "hidden" ? current.hidden : current[field] !== null;
  const isCleared = (field: ProductOverrideField) => cleared.includes(field);
  const text = (field: "name" | "description" | "seo_title" | "seo_description") => isCleared(field) ? "" : current[field] ?? "";
  const reset = (field: ProductOverrideField) => {
    const form = new FormData();
    form.set("id", productId);
    form.set("version", version);
    form.set("reset", field);
    startTransition(() => action(form));
  };
  const label = (field: ProductOverrideField, htmlFor: string, title = productOverrideLabels[field]) => <div className="flex flex-wrap items-center justify-between gap-2">
    <div className="flex flex-wrap items-center gap-2">
      <FieldLabel htmlFor={htmlFor}>{title}</FieldLabel>
      {overridden(field) ? <Badge variant="info"><Pencil data-icon="inline-start" aria-hidden="true"/>Elle</Badge> : <Badge variant="outline">Otomatik</Badge>}
    </div>
    {overridden(field) && <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => reset(field)}>
      <RotateCcw data-icon="inline-start" aria-hidden="true"/>Otomatiğe dön<span className="sr-only">: {productOverrideLabels[field]}</span>
    </Button>}
  </div>;
  const id = (field: ProductOverrideField) => `${fieldId}-${field}`;
  const key = (field: ProductOverrideField) => `${field}-${isCleared(field)}`;

  return <form action={action} className="flex flex-col gap-6" onChange={edited}>
    <input type="hidden" name="id" value={productId}/>
    <input type="hidden" name="version" value={version}/>
    <fieldset disabled={pending} key={saved}>
      <FieldGroup className="grid gap-6 md:grid-cols-2">
        <Field>
          {label("name", id("name"))}
          <Input key={key("name")} id={id("name")} name="name" maxLength={300} defaultValue={text("name")} placeholder={automatic.name} aria-describedby={`${id("name")}-hint`}/>
          <FieldDescription id={`${id("name")}-hint`}>Boş bırakılırsa: {automatic.name}</FieldDescription>
        </Field>
        <Field>
          {label("category_id", id("category_id"))}
          <CategoryCombobox key={key("category_id")} id={id("category_id")} name="category_id" placeholder="Kategori ara" options={categories}
            defaultValue={isCleared("category_id") || current.category_id === null ? null : String(current.category_id)}
            describedBy={`${id("category_id")}-hint`} onValueChange={edited}/>
          <FieldDescription id={`${id("category_id")}-hint`}>{automatic.category ? `Boş bırakılırsa: ${automatic.category}` : "Otomatik kategori yok; boş bırakılırsa kategori atanmaz."}</FieldDescription>
        </Field>
        <Field className="md:col-span-2">
          {label("description", id("description"))}
          <Textarea key={key("description")} id={id("description")} name="description" rows={6} maxLength={5000} defaultValue={text("description")} aria-describedby={`${id("description")}-hint`}/>
          <FieldDescription id={`${id("description")}-hint`}>Boş bırakılırsa: {automatic.description ? excerpt(automatic.description) : "Tedarikçi açıklaması yok."}</FieldDescription>
        </Field>
        <Field orientation="horizontal" className="md:col-span-2">
          <Switch key={key("hidden")} id={id("hidden")} name="published" defaultChecked={isCleared("hidden") || !current.hidden} onCheckedChange={edited}
            aria-describedby={`${id("hidden")}-hint`}/>
          <FieldContent>
            {label("hidden", id("hidden"), "Mağazada yayında")}
            <FieldDescription id={`${id("hidden")}-hint`}>Otomatik: yayında. Kapalıyken ürün mağazada, sepette, bayi API&apos;sinde ve bakım setlerinde görünmez; satışa kapanır.</FieldDescription>
          </FieldContent>
        </Field>
        <Field>
          {label("seo_title", id("seo_title"))}
          <Input key={key("seo_title")} id={id("seo_title")} name="seo_title" maxLength={120} defaultValue={text("seo_title")} aria-describedby={`${id("seo_title")}-hint`}/>
          <FieldDescription id={`${id("seo_title")}-hint`}>Boş bırakılırsa marka, ürün adı ve koddan oluşturulur.</FieldDescription>
        </Field>
        <Field>
          {label("seo_description", id("seo_description"))}
          <Textarea key={key("seo_description")} id={id("seo_description")} name="seo_description" rows={3} maxLength={300} defaultValue={text("seo_description")} aria-describedby={`${id("seo_description")}-hint`}/>
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
