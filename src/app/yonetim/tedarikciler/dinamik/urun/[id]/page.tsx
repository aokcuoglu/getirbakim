import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronsUpDown, CircleCheck, ExternalLink, History, Info, TriangleAlert } from "lucide-react";
import { getProduct, money } from "@/modules/store/catalog";
import { adminDinamikItem } from "@/modules/admin/dinamik";
import { adminProductPricing } from "@/modules/admin/product-pricing";
import { ProductPricingDialog } from "@/components/admin/product-pricing-dialog";
import { supplierFieldChanges } from "@/modules/admin/supplier-changes";
import { dinamikRegions, dinamikRegionStock } from "@/modules/suppliers/dinamik-stock";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

const date = (value: Date) => value.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const number = (value: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 6 }).format(value);
const changeKinds: Record<string, string> = { added: "Yeni ürün", changed: "Veri değişti", missing: "Listede bulunamadı", inactive: "Pasife alındı", restored: "Geri geldi" };
const fieldNames: Record<string, string> = {
  product: "Ürün", price: "Fiyat", stock: "Stok", presence: "Liste durumu", conflicting: "Çelişki", variants: "Kaynak varyantları", stockListPrice: "Stok listesi fiyatı",
  no: "Mağaza ürün kodu", ac: "Mağaza ürün adı", ac2: "Mağaza açıklaması", uk: "Mağaza üreticisi", oe: "Mağaza OEM listesi", dc: "Para birimi", nf: "Mağaza maliyeti", stok: "Mağaza stok bayrağı",
  stokKodu: "Ürün kodu", stokAdi: "Ürün adı", marka: "Marka", fiyat: "Liste fiyatı", kampanyaOrani: "Kampanya alanı",
  ingilizceAdi: "İngilizce adı", kull1s: "Araç markası (kaynak)", kull3s: "Üretici", kull7s: "Ürün grubu", kull8s: "Ürün tipi", oemListe: "OEM listesi", esdegerListe: "Eşdeğer listesi",
  barkod1: "Barkod 1", barkod2: "Barkod 2", barkod3: "Barkod 3", paketMiktari: "Paket miktarı", koliMiktari: "Koli miktarı", olcuBirimi: "Ölçü birimi", desi: "Desi", resimUrl: "Görsel adresi", kaporta: "Kaporta",
  ...Object.fromEntries(dinamikRegions.map(region => [region.key, region.label])),
};
type Tone = "success" | "warning" | "info" | "neutral";
const statusBadge = (tone: Tone, text: string) => tone === "success" ? <Badge variant="secondary"><CircleCheck data-icon="inline-start" aria-hidden="true"/>{text}</Badge>
  : tone === "warning" ? <Badge variant="outline"><TriangleAlert data-icon="inline-start" aria-hidden="true"/>{text}</Badge>
  : tone === "info" ? <Badge variant="outline"><Info data-icon="inline-start" aria-hidden="true"/>{text}</Badge> : <Badge variant="outline">{text}</Badge>;

function Timestamp({ value }: { value: Date }) {
  return <time dateTime={value.toISOString()} className="tabular-nums">{date(value)}</time>;
}

function Fields({ values, numeric = [] }: { values: Record<string, ReactNode>; numeric?: string[] }) {
  return <Table><TableBody>{Object.entries(values).map(([key, value]) => <TableRow key={key}>
    <TableHead scope="row" className="text-muted-foreground">{key}</TableHead>
    <TableCell className={numeric.includes(key) ? "text-right tabular-nums" : "whitespace-normal break-words"}>{value === null || value === undefined || value === "" ? "—" : value}</TableCell>
  </TableRow>)}</TableBody></Table>;
}

function ChangeValue({ value, path }: { value: unknown; path: string[] }) {
  if (value === undefined) return <span className="text-muted-foreground">Alan yok</span>;
  if (value === null) return <span className="text-muted-foreground">Boş</span>;
  if (value === "") return <span className="text-muted-foreground">Boş metin</span>;
  if (path.at(-1) === "presence" && typeof value === "string") return ({ present: "Güncel listede var", pending_missing: "Son listede bulunamadı", inactive: "Pasif" } as Record<string, string>)[value] ?? value;
  if (typeof value === "number") return <span className="block text-right tabular-nums">{["fiyat", "nf", "stockListPrice"].includes(path.at(-1) ?? "") ? money(Math.round(value * 100)) : number(value)}</span>;
  if (typeof value === "boolean") return value ? "Evet" : "Hayır";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function SourceJson({ label, value }: { label: string; value: unknown }) {
  return <Collapsible>
    <CollapsibleTrigger render={<Button variant="link" size="sm"/>}><ChevronsUpDown data-icon="inline-start" aria-hidden="true"/>{label}</CollapsibleTrigger>
    <CollapsibleContent><Textarea readOnly aria-label={label} className="max-h-80 font-mono" value={JSON.stringify(value, null, 2)}/></CollapsibleContent>
  </Collapsible>;
}

export default async function DinamikItem({ params }: { params: Promise<{ id: string }> }) {
  const item = await adminDinamikItem((await params).id);
  if (!item) notFound();
  const p = item.product_data;
  const [sale, pricing] = await Promise.all([getProduct(item.id), adminProductPricing(item.id)]);
  const listHref = `/yonetim/tedarikciler/dinamik?brand=${encodeURIComponent(item.list_group)}`;
  const price = item.price_data?.fiyat;
  const snapshot = sale?.pricing_snapshot.checkout_mode === "snapshot";
  const presence = item.presence === "present" ? "Güncel listede var" : item.presence === "inactive" ? "Pasif" : "Son listede bulunamadı";
  const saleState = sale?.available ? snapshot ? "Teyit bekliyor" : "Satışa açık" : item.conflicting ? "İnceleme gerekli" : item.presence !== "present" ? "Satışa kapalı" : !sale?.price_kurus ? "Hazırlıkta" : "Satışa kapalı";
  const unit = p.olcuBirimi ? ` ${p.olcuBirimi}` : "";
  const kaporta = item.stock_data?.kaporta?.trim().toUpperCase();
  const stocks = [
    ...dinamikRegions.map(region => ({ label: region.label, available: dinamikRegionStock(item.stock_data, region.key) })),
    { label: "Kaporta", available: kaporta === "VAR" ? true : kaporta === "YOK" ? false : null },
  ];

  return <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <Breadcrumb><BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink render={<Link href="/yonetim"/>}>Yönetim</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator/>
        <BreadcrumbItem><BreadcrumbLink render={<Link href="/yonetim/tedarikciler"/>}>Tedarikçiler</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator/>
        <BreadcrumbItem><BreadcrumbLink render={<Link href={listHref}/>}>Dinamik</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator/>
        <BreadcrumbItem><BreadcrumbPage>{item.code}</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList></Breadcrumb>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-mono text-2xl font-semibold tracking-tight break-all">{item.code}</h1>
          <p className="text-muted-foreground">{p.stokAdi || "Yalnız fiyat listesinde — ürün bilgisi yok"} · {item.list_group}</p>
        </div>
        <Button variant="outline" nativeButton={false} render={<Link href={listHref}/>}><ArrowLeft data-icon="inline-start" aria-hidden="true"/>Ürün listesine dön</Button>
      </div>
    </div>

    <Card>
      <CardHeader><CardTitle><h2>Fiyat ve satış durumu</h2></CardTitle><CardAction>{statusBadge(sale?.available && !snapshot ? "success" : "warning", saleState)}</CardAction></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Card size="sm"><CardHeader><CardDescription>Getirbakim satış fiyatı</CardDescription><CardTitle className="text-2xl font-semibold tabular-nums">{sale?.price_kurus ? money(sale.price_kurus) : "—"}</CardTitle></CardHeader><CardContent className="text-muted-foreground">KDV dahil</CardContent></Card>
          <Card size="sm"><CardHeader><CardDescription>Kaynak liste fiyatı</CardDescription><CardTitle className="text-2xl font-semibold tabular-nums">{typeof price === "number" ? money(Math.round(price * 100)) : "—"}</CardTitle></CardHeader><CardContent className="text-muted-foreground">KDV hariç maliyet</CardContent></Card>
          <Card size="sm"><CardHeader><CardDescription>Satış durumu</CardDescription><CardTitle>{saleState}</CardTitle></CardHeader><CardContent className="text-muted-foreground">{sale?.stock_label ?? (item.stock_data ? "Bu kayıt için mağazada satış bilgisi bulunamadı." : "Stok listesinde ürün bilgisi yok; mağazada gösterilmiyor.")}</CardContent></Card>
        </div>
        <p className="text-muted-foreground tabular-nums">Kâr %{number(pricing.markup ?? pricing.generalMarkup)} ({pricing.markup === null ? "genel" : "ürüne özel"}) · KDV %{number(pricing.vat ?? pricing.generalVat)} ({pricing.vat === null ? "genel" : "ürüne özel"})</p>
        <Separator/>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground">
          {statusBadge(item.presence === "present" ? "success" : "warning", presence)}
          <span>Son görülme: <Timestamp value={item.last_seen_at}/> · İstanbul saati</span>
        </div>
      </CardContent>
      <CardFooter className="flex-wrap gap-2">
        <ProductPricingDialog id={item.id} code={item.code} cost={typeof price === "number" ? price : null} pricing={pricing}/>
        {sale && <Button nativeButton={false} render={<Link href={`/urun/${sale.id}`}/>}>Katalogda aç<ExternalLink data-icon="inline-end" aria-hidden="true"/></Button>}
      </CardFooter>
    </Card>

    {item.conflicting && <Alert><TriangleAlert aria-hidden="true"/><AlertTitle>Kaynak verisi inceleme gerektiriyor</AlertTitle><AlertDescription>Aynı ürün kodu için çelişkili değerler bulundu. Farklı yanıtları veri kontrolü bölümünde inceleyebilirsiniz.</AlertDescription></Alert>}

    <div className="grid items-start gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader><CardTitle><h2>Ürün bilgileri</h2></CardTitle><CardDescription>Araç markası ve grup alanları kaynak metinlerdir; doğrulanmış araç uyumluluğu değildir.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Fields values={{ Üretici: p.kull3s || p.marka, "Araç markası (kaynak)": p.kull1s, "Ürün grubu": p.kull7s, "Ürün tipi": p.kull8s,
            Barkod: [p.barkod1, p.barkod2, p.barkod3].filter(Boolean).join(", "),
            "Paket miktarı": p.paketMiktari !== undefined ? `${number(p.paketMiktari)}${unit}` : null,
            "Koli miktarı": p.koliMiktari !== undefined ? `${number(p.koliMiktari)}${unit}` : null,
            Desi: typeof p.desi === "number" ? number(p.desi) : null,
          }} numeric={["Paket miktarı", "Koli miktarı", "Desi"]}/>
          <Collapsible>
            <CollapsibleTrigger render={<Button variant="link" size="sm"/>}><ChevronsUpDown data-icon="inline-start" aria-hidden="true"/>Diğer ürün alanları</CollapsibleTrigger>
            <CollapsibleContent><Fields values={{ "İngilizce adı": p.ingilizceAdi, "OEM listesi": p.oemListe, "Eşdeğer listesi": p.esdegerListe, "Görsel adresi": p.resimUrl }}/></CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle><h2>Kaynak stokları</h2></CardTitle><CardDescription>Var / Yok, tedarikçinin stok bayrağıdır; adet veya satış teyidi değildir.</CardDescription></CardHeader>
        <CardContent>
          {item.stock_data ? <Table><TableBody>{stocks.map(stock => <TableRow key={stock.label}>
            <TableHead scope="row" className="text-muted-foreground">{stock.label}</TableHead>
            <TableCell className="text-right"><Badge variant={stock.available ? "secondary" : "outline"}>{stock.available === null ? "Veri yok" : stock.available ? "Var" : "Yok"}</Badge></TableCell>
          </TableRow>)}</TableBody></Table> : <Empty><EmptyHeader><EmptyTitle>Stok satırı bulunamadı</EmptyTitle><EmptyDescription>Bu kod yalnız fiyat listesinde. Bölge stokları bilinmiyor.</EmptyDescription></EmptyHeader></Empty>}
        </CardContent>
      </Card>
    </div>

    <Card>
      <CardHeader><CardTitle><h2>Değişiklik geçmişi</h2></CardTitle><CardDescription>Son 90 gün içindeki en son 20 kayıt. Önce yalnız değişen alanlar gösterilir; ham kayıtlar ayrıntılarda korunur.</CardDescription></CardHeader>
      <CardContent>
        {item.changes.length ? <div className="flex flex-col gap-2">{item.changes.map((change, index) => {
          const changes = supplierFieldChanges(change.before_data, change.after_data);
          return <Collapsible key={change.id} className="flex flex-col gap-2">
            {index > 0 && <Separator/>}
            <div className="flex flex-wrap items-center gap-2">
              <CollapsibleTrigger render={<Button variant="ghost" size="sm"/>}><ChevronsUpDown data-icon="inline-start" aria-hidden="true"/><Timestamp value={change.changed_at}/></CollapsibleTrigger>
              {statusBadge(change.kind === "added" || change.kind === "restored" ? "success" : change.kind === "changed" ? "info" : "warning", changeKinds[change.kind] ?? change.kind)}
            </div>
            <CollapsibleContent className="flex flex-col gap-2">
              {changes.length ? <Table><caption className="sr-only">{date(change.changed_at)} değişen alanlar</caption>
                <TableHeader><TableRow><TableHead>Alan</TableHead><TableHead>Önce</TableHead><TableHead>Sonra</TableHead></TableRow></TableHeader>
                <TableBody>{changes.map(field => <TableRow key={JSON.stringify(field.path)}>
                  <TableHead scope="row" className="whitespace-normal">{field.path.map(key => fieldNames[key] ?? key).join(" · ") || "Kayıt"}</TableHead>
                  <TableCell className="whitespace-normal break-words"><ChangeValue value={field.before} path={field.path}/></TableCell>
                  <TableCell className="whitespace-normal break-words"><ChangeValue value={field.after} path={field.path}/></TableCell>
                </TableRow>)}</TableBody>
              </Table> : <p className="text-muted-foreground">Ürün, fiyat ve stok alanlarında fark yok; kayıt durumu değişti.</p>}
              <SourceJson label="Ham geçmiş kaydını göster" value={{ önce: change.before_data, sonra: change.after_data }}/>
            </CollapsibleContent>
          </Collapsible>;
        })}</div> : <Empty><EmptyHeader><EmptyMedia variant="icon"><History/></EmptyMedia><EmptyTitle>Kayıtlı değişiklik yok</EmptyTitle></EmptyHeader></Empty>}
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle><h2>Veri kontrolü</h2></CardTitle><CardDescription>Kaynak tarihler, fiyat karşılaştırması ve ham API alanları.</CardDescription><CardAction>{statusBadge(item.conflicting ? "warning" : "neutral", item.conflicting ? "İnceleme gerekli" : "Çelişki bulunmadı")}</CardAction></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <Fields values={{ "İlk görülme": <Timestamp value={item.first_seen_at}/>, "Son değişim": <Timestamp value={item.changed_at}/>, "Fiyat satırı": number(item.price_count), "Stok satırı": number(item.stock_count) }} numeric={["Fiyat satırı", "Stok satırı"]}/>
          <div className="flex min-w-0 flex-col gap-3">
            <Fields values={{ "Kampanya alanı": item.price_data?.kampanyaOrani !== undefined ? number(item.price_data.kampanyaOrani) : null,
              "Stok listesi fiyatı": !item.stock_data ? "Stok satırı yok" : typeof item.source_variants.stockListPrice === "number" ? `${money(Math.round(item.source_variants.stockListPrice * 100))} · fiyat listesiyle farklı` : "Fiyat listesiyle aynı",
            }} numeric={["Kampanya alanı"]}/>
            <p className="text-muted-foreground">Kampanya alanının anlamı doğrulanmadı; satış fiyatına uygulanmaz. Tüm tarihler İstanbul saatindedir.</p>
          </div>
        </div>
        <SourceJson label="Kaynak alanlarını göster" value={{ product: item.product_data, price: item.price_data, stock: item.stock_data, conflictingVariants: item.source_variants }}/>
      </CardContent>
    </Card>
  </div>;
}
