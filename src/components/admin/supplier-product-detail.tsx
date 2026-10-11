import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronsUpDown, CircleCheck, ExternalLink, History, Info, TriangleAlert } from "lucide-react";
import { money, type CatalogProduct } from "@/modules/store/catalog";
import type { ProductPricing } from "@/modules/admin/product-pricing-schema";
import { ProductPricingDialog } from "@/components/admin/product-pricing-dialog";
import { supplierFieldChanges, type SupplierChange } from "@/modules/admin/supplier-changes";
import { dinamikRegions } from "@/modules/suppliers/dinamik-stock";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const supplierDate = (value: Date) => value.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const supplierNumber = (value: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 6 }).format(value);
const changeKinds: Record<string, string> = { added: "Yeni ürün", changed: "Veri değişti", missing: "Listede bulunamadı", inactive: "Pasife alındı", restored: "Geri geldi" };
const fieldNames: Record<string, string> = {
  product: "Ürün", price: "Fiyat", stock: "Stok", presence: "Liste durumu", conflicting: "Çelişki", variants: "Kaynak varyantları", stockListPrice: "Stok listesi fiyatı",
  no: "Ürün kodu", ac: "Ürün adı", ac2: "Ek açıklama", uk: "Üretici", oe: "OEM referansları", dc: "Para birimi", nf: "KDV hariç maliyet (NF)", stok: "Stok bayrağı",
  stokKodu: "Ürün kodu", stokAdi: "Ürün adı", marka: "Marka", fiyat: "Liste fiyatı", kampanyaOrani: "Kampanya alanı",
  ingilizceAdi: "İngilizce adı", kull1s: "Araç markası (kaynak)", kull3s: "Üretici", kull7s: "Ürün grubu", kull8s: "Ürün tipi", oemListe: "OEM listesi", esdegerListe: "Eşdeğer listesi",
  barkod1: "Barkod 1", barkod2: "Barkod 2", barkod3: "Barkod 3", paketMiktari: "Paket miktarı", koliMiktari: "Koli miktarı", olcuBirimi: "Ölçü birimi", desi: "Desi", resimUrl: "Görsel adresi", kaporta: "Kaporta",
  lgk: "Liste grubu", m: "Model açıklaması", mo: "Motor açıklaması", y: "Yıl açıklaması", b: "Birim", lf: "Liste fiyatı (LF)", mif: "MIF (kaynak)", k: "K (kaynak)", mkk: "MKK (kaynak)",
  depolar: "Depolar", sYol: "Yolda", sDepo: "Depo kodu", sFarkliDepo: "Diğer öncelik depoları",
  source_category: "Kategori (kaynak)", vehicle_brand: "Araç markası (kaynak)", cross: "Çapraz referans", image: "Görsel adresi",
  ...Object.fromEntries(dinamikRegions.map(region => [region.key, region.label])),
};

export function Timestamp({ value }: { value: Date }) {
  return <time dateTime={value.toISOString()} className="tabular-nums">{supplierDate(value)}</time>;
}

export function Fields({ values, numeric = [] }: { values: Record<string, ReactNode>; numeric?: string[] }) {
  return <Table><TableBody>{Object.entries(values).map(([key, value]) => <TableRow key={key}>
    <TableHead scope="row" className="w-2/5 whitespace-normal wrap-anywhere text-muted-foreground">{key}</TableHead>
    <TableCell className={cn("whitespace-normal wrap-anywhere tabular-nums", numeric.includes(key) && "text-right")}>{value === null || value === undefined || value === "" ? "—" : value}</TableCell>
  </TableRow>)}</TableBody></Table>;
}

function ChangeValue({ value, path, currency }: { value: unknown; path: string[]; currency: string }) {
  if (value === undefined) return <span className="text-muted-foreground">Alan yok</span>;
  if (value === null) return <span className="text-muted-foreground">Boş</span>;
  if (value === "") return <span className="text-muted-foreground">Boş metin</span>;
  if (path.at(-1) === "presence" && typeof value === "string") return ({ present: "Güncel listede var", pending_missing: "Son listede bulunamadı", inactive: "Pasif" } as Record<string, string>)[value] ?? value;
  if (typeof value === "number") return <span className="block text-right tabular-nums">{["fiyat", "nf", "stockListPrice"].includes(path.at(-1) ?? "") ? sourceMoney(value, currency) : supplierNumber(value)}</span>;
  if (typeof value === "boolean") return value ? "Evet" : "Hayır";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function statusBadge(tone: "success" | "warning" | "info" | "neutral", text: string) {
  return <Badge variant={tone === "success" ? "secondary" : "outline"}>
    {tone === "success" ? <CircleCheck data-icon="inline-start" aria-hidden="true"/> : tone === "warning" ? <TriangleAlert data-icon="inline-start" aria-hidden="true"/> : tone === "info" ? <Info data-icon="inline-start" aria-hidden="true"/> : null}{text}
  </Badge>;
}
export function SourceJson({ label, value }: { label: string; value: unknown }) {
  return <Collapsible className="min-w-0">
    <CollapsibleTrigger render={<Button variant="ghost"/>}><ChevronsUpDown data-icon="inline-start" aria-hidden="true"/>{label}</CollapsibleTrigger>
    <CollapsibleContent><Textarea readOnly aria-label={label} className="max-h-80 font-mono" value={JSON.stringify(value, null, 2)}/></CollapsibleContent>
  </Collapsible>;
}
export function sourceMoney(value: number, currency = "TRY") {
  return currency === "TRY" || currency === "TL" ? money(Math.round(value * 100)) : `${supplierNumber(value)} ${currency || "Para birimi belirtilmemiş"}`;
}
function historyCurrency(data: Record<string, unknown> | null, fallback: string) {
  const product = data?.product as Record<string, unknown> | undefined;
  return typeof product?.dc === "string" ? product.dc : fallback;
}
export function SupplierHistory({ changes, currency = "TRY" }: { changes: SupplierChange[]; currency?: string }) {
  return <Card>
    <CardHeader><CardTitle><h2>Değişiklik geçmişi</h2></CardTitle><CardDescription>Son 90 gün içindeki en son 20 kayıt. Önce yalnız değişen alanlar gösterilir; ham kayıtlar ayrıntılarda korunur.</CardDescription></CardHeader>
    <CardContent>
      {changes.length ? <div className="flex min-w-0 flex-col gap-2">{changes.map((change, index) => {
        const fields = supplierFieldChanges(change.before_data, change.after_data);
        return <Collapsible key={change.id} className="min-w-0">
          {index > 0 && <Separator/>}
          <div className="flex flex-wrap items-center gap-2 py-2">
            <CollapsibleTrigger render={<Button variant="ghost"/>}><ChevronsUpDown data-icon="inline-start" aria-hidden="true"/><Timestamp value={change.changed_at}/></CollapsibleTrigger>
            {statusBadge(change.kind === "added" || change.kind === "restored" ? "success" : change.kind === "changed" ? "info" : "warning", changeKinds[change.kind] ?? change.kind)}
          </div>
          <CollapsibleContent className="flex min-w-0 flex-col gap-2">
            {fields.length ? <Table aria-label={`${supplierDate(change.changed_at)} değişen alanlar`}>
                <TableHeader><TableRow><TableHead className="w-2/5">Alan</TableHead><TableHead>Önce</TableHead><TableHead>Sonra</TableHead></TableRow></TableHeader>
                <TableBody>{fields.map(field => <TableRow key={JSON.stringify(field.path)}>
                  <TableHead scope="row" className="whitespace-normal wrap-anywhere align-top">{field.path.map(key => fieldNames[key] ?? key).join(" · ") || "Kayıt"}</TableHead>
                  <TableCell className="whitespace-normal wrap-anywhere align-top"><ChangeValue value={field.before} path={field.path} currency={historyCurrency(change.before_data, currency)}/></TableCell>
                  <TableCell className="whitespace-normal wrap-anywhere align-top"><ChangeValue value={field.after} path={field.path} currency={historyCurrency(change.after_data, currency)}/></TableCell>
                </TableRow>)}</TableBody>
              </Table> : <p className="text-muted-foreground">Ürün, fiyat ve stok alanlarında fark yok; kayıt durumu değişti.</p>}
            <SourceJson label="Ham geçmiş kaydını göster" value={{ önce: change.before_data, sonra: change.after_data }}/>
          </CollapsibleContent>
        </Collapsible>;
      })}</div> : <Empty><EmptyHeader><EmptyMedia variant="icon"><History/></EmptyMedia><EmptyTitle>Kayıtlı değişiklik yok</EmptyTitle></EmptyHeader></Empty>}
    </CardContent>
  </Card>;
}
export function SupplierStocks({ stocks }: { stocks: { label: string; available: boolean | null; note?: string }[] }) {
  return <Table><TableBody>{stocks.map(stock => <TableRow key={stock.label}>
    <TableHead scope="row" className="whitespace-normal wrap-anywhere text-muted-foreground">{stock.label}</TableHead>
    <TableCell className="text-right whitespace-normal"><Badge variant={stock.available ? "secondary" : "outline"}>{stock.available === null ? "Veri yok" : stock.available ? "Var" : "Yok"}</Badge>{stock.note && <span className="mt-1 block text-xs text-muted-foreground">{stock.note}</span>}</TableCell>
  </TableRow>)}</TableBody></Table>;
}
type DetailItem = {
  id: string; code: string; presence: string; conflicting: boolean; last_seen_at: Date;
  product_data: unknown; price_data: unknown; stock_data: unknown; source_variants: unknown; changes: SupplierChange[];
};
export function SupplierProductDetail({ item, supplier, listHref, description, sale, pricing, cost, sourcePriceLabel = "Kaynak liste fiyatı", noSaleMessage, productInfo, stockInfo, dataInfo }: {
  item: DetailItem; supplier: string; listHref: string; description: ReactNode; sale: CatalogProduct | undefined; pricing: ProductPricing;
  cost: number | null; sourcePriceLabel?: string; noSaleMessage?: string; productInfo: ReactNode; stockInfo: ReactNode; dataInfo: ReactNode;
}) {
  const snapshot = sale?.pricing_snapshot.checkout_mode === "snapshot";
  const presence = item.presence === "present" ? "Güncel listede var" : item.presence === "inactive" ? "Pasif" : "Son listede bulunamadı";
  const saleState = sale?.available && sale.price_kurus ? snapshot ? "Teyit bekliyor" : "Satışa açık" : item.conflicting ? "İnceleme gerekli" : item.presence !== "present" || noSaleMessage ? "Satışa kapalı" : !sale?.price_kurus ? "Hazırlıkta" : "Satışa kapalı";
  return <div className="flex min-w-0 flex-col gap-6">
    <div className="flex min-w-0 flex-col gap-2">
      <Breadcrumb><BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink render={<Link href="/yonetim"/>}>Yönetim</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator/>
        <BreadcrumbItem><BreadcrumbLink render={<Link href="/yonetim/tedarikciler"/>}>Tedarikçiler</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator/>
        <BreadcrumbItem><BreadcrumbLink render={<Link href={listHref}/>}>{supplier}</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator/>
        <BreadcrumbItem className="min-w-0"><BreadcrumbPage className="wrap-anywhere">{item.code}</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList></Breadcrumb>
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-4">
        <div className="min-w-0"><h1 className="wrap-anywhere font-mono text-2xl font-semibold tracking-tight">{item.code}</h1><p className="wrap-anywhere text-muted-foreground">{description}</p></div>
        <Button variant="outline" nativeButton={false} render={<Link href={listHref}/>}><ArrowLeft data-icon="inline-start" aria-hidden="true"/>Ürün listesine dön</Button>
      </div>
    </div>
    <Card role="region" aria-label="Fiyat ve satış durumu">
      <CardHeader><CardTitle><h2>Fiyat ve satış durumu</h2></CardTitle></CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <div className="grid min-w-0 gap-4 sm:grid-cols-3">
          <Card size="sm" className="min-w-0"><CardHeader><CardDescription>Getirbakim satış fiyatı</CardDescription><CardTitle className="wrap-anywhere"><span className="text-2xl font-semibold tabular-nums">{sale?.price_kurus ? money(sale.price_kurus) : "—"}</span></CardTitle></CardHeader><CardContent className="text-muted-foreground">KDV dahil</CardContent></Card>
          <Card size="sm" className="min-w-0"><CardHeader><CardDescription>{sourcePriceLabel}</CardDescription><CardTitle className="wrap-anywhere"><span className="text-2xl font-semibold tabular-nums">{cost !== null ? sourceMoney(cost, pricing.currency ?? "") : "—"}</span></CardTitle></CardHeader><CardContent className="text-muted-foreground">KDV hariç maliyet</CardContent></Card>
          <Card size="sm" className="min-w-0"><CardHeader><CardDescription>Satış durumu</CardDescription><CardTitle>{statusBadge(sale?.available && sale.price_kurus && !snapshot ? "success" : "warning", saleState)}</CardTitle></CardHeader><CardContent className="text-muted-foreground">{sale?.stock_label ?? noSaleMessage ?? (item.stock_data ? "Bu kayıt için mağazada satış bilgisi bulunamadı." : "Stok listesinde ürün bilgisi yok; mağazada gösterilmiyor.")}</CardContent></Card>
        </div>
        <p className="text-muted-foreground tabular-nums">Kâr %{supplierNumber(pricing.markup ?? pricing.generalMarkup)} ({pricing.markup === null ? "genel" : "ürüne özel"}) · KDV %{supplierNumber(pricing.vat ?? pricing.generalVat)} ({pricing.vat === null ? "genel" : "ürüne özel"})</p>
        <Separator/>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground">
          {statusBadge(item.presence === "present" ? "success" : "warning", presence)}<span>Son görülme: <Timestamp value={item.last_seen_at}/> · İstanbul saati</span>
        </div>
      </CardContent>
      <CardFooter className="flex-wrap gap-2">
        <ProductPricingDialog id={item.id} code={item.code} cost={cost} pricing={pricing}/>
        {sale && <Button nativeButton={false} render={<Link href={`/urun/${sale.id}`}/>}>Katalogda aç<ExternalLink data-icon="inline-end" aria-hidden="true"/></Button>}
      </CardFooter>
    </Card>
    {item.conflicting && <Alert><TriangleAlert aria-hidden="true"/><AlertTitle>Kaynak verisi inceleme gerektiriyor</AlertTitle><AlertDescription>Aynı ürün kodu için çelişkili değerler bulundu. Farklı yanıtları veri kontrolü bölümünde inceleyebilirsiniz.</AlertDescription></Alert>}
    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-2">{productInfo}{stockInfo}</div>
    <SupplierHistory changes={item.changes} currency={pricing.currency ?? "TRY"}/>
    <Card>
      <CardHeader><CardTitle><h2>Veri kontrolü</h2></CardTitle><CardDescription>Kaynak tarihler, fiyat karşılaştırması ve ham API alanları.</CardDescription></CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <div>{statusBadge(item.conflicting ? "warning" : "neutral", item.conflicting ? "İnceleme gerekli" : "Çelişki bulunmadı")}</div>
        {dataInfo}
        <SourceJson label="Kaynak alanlarını göster" value={{ product: item.product_data, price: item.price_data, stock: item.stock_data, conflictingVariants: item.source_variants }}/>
      </CardContent>
    </Card>
  </div>;
}
