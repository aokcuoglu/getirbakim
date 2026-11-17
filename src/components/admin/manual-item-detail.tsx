import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleAlert, CircleCheck } from "lucide-react";
import { adminManualItem } from "@/modules/admin/manual";
import { categoryLabel } from "@/modules/suppliers/manual-template";
import { activeBulk, fileFilled, manualEditableFields, type ManualEditableField } from "@/modules/suppliers/manual-import";
import { SubmitButton } from "@/components/admin/submit-button";
import { Fields, SupplierProductDetail, Timestamp } from "@/components/admin/supplier-product-detail";
import { formatExact, formatNumber } from "@/modules/admin/format";
import { StatusBadge } from "@/components/admin/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveManualItem } from "@/app/yonetim/tedarikciler/manuel/actions";

const labels: Record<ManualEditableField, { label: string; hint: string }> = {
  price: { label: "Fiyat (KDV hariç alış, TL)", hint: "Boşsa ürün satışa kapalı listelenir." },
  stock: { label: "Stok (adet)", hint: "Boşsa “stok bilgisi yok” görünür." },
  barcode: { label: "Barkod", hint: "EAN/GTIN." },
  description: { label: "Açıklama", hint: "Ürün sayfasında görünür (en fazla 3.000 karakter)." },
  viscosity: { label: "Viskozite", hint: "Örn. 5W-30." },
  package: { label: "Ambalaj", hint: "Kapasite: 1 L, 4 L, 500 ml, 16 kg; koli: 4 × 4 L." },
  approvals: { label: "Onaylar/Normlar", hint: "Örn. API SP; ACEA C3." },
  imageUrl: { label: "Resim linki", hint: "Doğrudan resim dosyası linki; kaydederken indirilir." },
};
const errors: Record<string, string> = {
  input: "Fiyat ve stok sayı olmalı; resim linki doğrudan bir resim dosyasına gitmeli.",
  invalid: "Değer kaydedilemedi",
  busy: "Başka bir manuel liste işlemi sürüyor. Biraz sonra yeniden deneyin.",
  locked: "Ürün şu anda başka bir işlemde (ör. ürün eşleştirme) güncelleniyor; kayıt yapılmadı. Bir iki dakika sonra yeniden deneyin.",
  "not-found": "Ürün bulunamadı.",
};

/** Body of the manual list product page; also opened in a dialog over the list (modal). `query` carries the save result. */
export async function ManualItemDetail({ id, query, modal = false }: { id: string; query: Record<string, string | undefined>; modal?: boolean }) {
  const item = await adminManualItem(id);
  if (!item) notFound();
  const p = item.product_data;
  const { sale, pricing } = item;
  const category = item.categories.find(entry => entry.id === p.category_id);
  const overrides = item.overrides ?? {};
  const value = (field: ManualEditableField) => {
    const current = field === "price" ? item.price_data?.nf : field === "stock" ? item.stock_data?.stok : overrides[field] ?? p.file[field];
    return current === null || current === undefined ? "" : String(current);
  };
  // A CSV value in force (#832) wins over the file and the form; it changes only through another CSV or a changed file cell.
  const bulk = activeBulk(p.file, overrides);
  const fromCsv = (field: ManualEditableField) => Boolean(field === "price" && bulk.price || field === "stock" && bulk.stock);
  const fromFile = (field: ManualEditableField) => !fromCsv(field) && fileFilled(p.file, field);
  const fileNote = (field: ManualEditableField) => <>
    {field === "price" && p.file.listPrice != null && `Liste fiyatı ${formatExact(p.file.listPrice)} · iskonto %${formatNumber(p.file.discount ?? 0)}. `}
    Dosyadan geliyor; değiştirmek için dosyayı güncelleyip yeniden yükleyin.
  </>;
  const listHref = `/yonetim/tedarikciler/manuel?liste=${item.list_group}`;
  const csvNote = (field: ManualEditableField) => <>
    {field === "price" && bulk.price && `Liste fiyatı ${formatExact(bulk.price.list)} · iskonto %${formatNumber(bulk.price.discount)}. `}
    Toplu CSV ile güncellendi; değiştirmek için yeni bir CSV yükleyin (<Link className="underline underline-offset-4" href={listHref}>Manuel yükleme › Yükleme ve kontrol</Link>).
  </>;
  return <SupplierProductDetail item={item} modal={modal} cart={p.ac} supplier={`Manuel · ${p.list_name}`} listHref={listHref}
      notice={<>
        {query.saved === "1" && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>Kaydedildi; mağaza ve ürün sayfası güncellendi.</AlertDescription></Alert>}
        {query.error && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{errors[query.error] || "Kaydedilemedi."}{query.detail && ` (${query.detail})`}</AlertDescription></Alert>}
      </>}
      description={<>{p.ac} · {p.uk}</>} sale={sale} pricing={pricing} cost={item.price_data?.nf ?? null} sourcePriceLabel="Alış fiyatı"
      noSaleMessage={!item.price_data ? "Fiyat girilmediği için satışa kapalı; mağazada “Fiyat bilgisi güncelleniyor” görünür." : undefined}
      productInfo={<Card><CardHeader><CardTitle><h2>Ürün bilgileri</h2></CardTitle><CardDescription>Ürün kodu, ad, marka ve kategori yüklenen dosyadan gelir. Dosyada boş kalan alanları buradan tamamlayabilirsiniz; dosyada dolu olan alanlar dosyadaki değeri korur.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Fields values={{ Marka: p.uk, Kategori: category ? categoryLabel(category) : p.category_name, Liste: p.list_name, Resim: item.has_image ? <StatusBadge tone="success">Var</StatusBadge> : <StatusBadge tone="neutral">Yok</StatusBadge> }}/>
          <form action={saveManualItem} className="flex flex-col gap-4">
            <input type="hidden" name="id" value={item.id}/>
            <FieldGroup className="grid gap-4 md:grid-cols-2">
              {manualEditableFields.map(field => <Field key={field} className={field === "description" || field === "imageUrl" || field === "approvals" ? "md:col-span-2" : undefined}>
                <FieldLabel htmlFor={`manual-${field}`}>{labels[field].label}{fromCsv(field) ? <Badge variant="info">Toplu CSV</Badge> : fromFile(field) ? <Badge variant="outline">Dosyadan</Badge> : overrides[field] !== undefined ? <Badge variant="info">Panelden</Badge> : null}</FieldLabel>
                {field === "description"
                  ? <Textarea id={`manual-${field}`} name={field} defaultValue={value(field)} maxLength={3000} readOnly={fromFile(field)} rows={5}/>
                  : <Input id={`manual-${field}`} name={field} defaultValue={value(field)} readOnly={fromFile(field) || fromCsv(field)} inputMode={field === "price" ? "decimal" : field === "stock" ? "numeric" : undefined}/>}
                <FieldDescription>{fromCsv(field) ? csvNote(field) : fromFile(field) ? fileNote(field) : labels[field].hint}</FieldDescription>
              </Field>)}
            </FieldGroup>
            <div><SubmitButton icon={<CircleCheck data-icon="inline-start" aria-hidden="true"/>} pendingLabel="Kaydediliyor…">Kaydet</SubmitButton></div>
          </form>
        </CardContent></Card>}
      stockInfo={<Card><CardHeader><CardTitle><h2>Stok</h2></CardTitle><CardDescription>Manuel listede stok, girilen adettir; tedarikçi teyidi değildir.</CardDescription></CardHeader><CardContent>
        <Fields values={{ "Stok adedi": item.stock_data ? formatExact(item.stock_data.stok) : "Girilmemiş", "Mağaza durumu": sale?.stock_label ?? "—" }}/>
      </CardContent></Card>}
      dataInfo={<Fields values={{ "İlk yükleme": <Timestamp value={item.first_seen_at}/>, "Son değişim": <Timestamp value={item.changed_at}/>, "Son yükleme": <Timestamp value={item.last_seen_at}/>, "Resim kaynağı": p.image_url }}/>}/>;
}
