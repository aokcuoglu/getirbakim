import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProduct, money } from "@/modules/store/catalog";
import { adminBasbugItem } from "@/modules/admin/basbug";
import { ArrowRight, ChevronsUpDown, CircleCheck, History, Info, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { basbugStockLabel, basbugWarehouses, basbugWarehouseStock } from "@/modules/suppliers/basbug-stock";

const date = (value: Date) => value.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });
const warehouseNames: Record<string, string> = { MRK: "Merkez", IZM: "İzmir" };
const changeKinds: Record<string, string> = { added: "Yeni ürün", changed: "Veri değişti", missing: "Listede bulunamadı", inactive: "Pasife alındı", restored: "Geri geldi" };
type Tone = "success" | "warning" | "info";
const statusBadge = (tone: Tone, text: ReactNode) => tone === "success" ? <Badge variant="secondary"><CircleCheck data-icon="inline-start" aria-hidden="true"/>{text}</Badge>
  : tone === "warning" ? <Badge variant="outline"><TriangleAlert data-icon="inline-start" aria-hidden="true"/>{text}</Badge>
  : <Badge variant="outline"><Info data-icon="inline-start" aria-hidden="true"/>{text}</Badge>;

function Fields({ values }: { values: Record<string, unknown> }) {
  return <Table><TableBody>{Object.entries(values).map(([key, value]) => <TableRow key={key}><TableHead scope="row" className="text-muted-foreground">{key}</TableHead><TableCell className="whitespace-normal break-words tabular-nums">{value === null || value === undefined || value === "" ? "—" : String(value)}</TableCell></TableRow>)}</TableBody></Table>;
}

function Json({ label, value }: { label: string; value: unknown }) {
  return <Textarea readOnly aria-label={label} className="max-h-96 font-mono" value={JSON.stringify(value, null, 2)}/>;
}

export default async function SupplierItem({ params }: { params: Promise<{ id: string }> }) {
  const item = await adminBasbugItem((await params).id);
  if (!item) notFound();
  const p = item.product_data;
  const sale = await getProduct(item.id);
  const listHref = `/yonetim/tedarikciler/basbug?group=${encodeURIComponent(item.list_group)}`;
  return <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <Breadcrumb><BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink render={<Link href="/yonetim"/>}>Yönetim</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator/>
        <BreadcrumbItem><BreadcrumbLink render={<Link href="/yonetim/tedarikciler"/>}>Tedarikçiler</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator/>
        <BreadcrumbItem><BreadcrumbLink render={<Link href={listHref}/>}>Başbuğ</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator/>
        <BreadcrumbItem><BreadcrumbPage>{item.code}</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList></Breadcrumb>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-mono text-2xl font-semibold tracking-tight break-all">{item.code}</h1>
          <p className="text-muted-foreground">{p.ac} · {p.uk}</p>
          <p className="text-muted-foreground">{item.list_group} / {item.warehouse} · Çekim: {date(item.completed_at)} (İstanbul) · İlk görülme: {date(item.first_seen_at)} · Son değişim: {date(item.changed_at)}</p>
        </div>
        {statusBadge(item.presence === "present" ? "success" : "warning", item.presence === "present" ? "Güncel listede var" : item.presence === "inactive" ? "Pasif — iki başarılı çekimde bulunamadı" : "Son listede bulunamadı")}
      </div>
    </div>
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader><CardTitle><h2>Ürün bilgileri</h2></CardTitle><CardDescription>Model, motor ve yıl alanları kaynak metinlerdir; doğrulanmış araç uyumluluğu değildir.</CardDescription></CardHeader>
        <CardContent><Fields values={{ "Ek açıklama": p.ac2, "OEM referansları": p.oe, "Model açıklaması": p.m, "Motor açıklaması": p.mo, "Yıl açıklaması": p.y, "Birim": p.b, "Liste grubu": p.lgk, "MKK (kaynak)": p.mkk }}/></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle><h2>Kaynak fiyat ve stok</h2></CardTitle><CardDescription>NF, KDV hariç maliyettir. LF, MIF ve K satış hesaplamasında kullanılmaz. Depolar için stok bulunabilirliği gösterilir.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Fields values={{ "Para birimi": p.dc, LF: p.lf, "NF · KDV hariç maliyet": item.price_data?.nf ?? "Eksik", MIF: item.price_data?.mif ?? "Eksik", K: item.price_data?.k ?? "Eksik", "Yolda": item.stock_data?.sYol === undefined ? "Veri yok" : item.stock_data.sYol > 0 ? "Var" : "Yok", "Diğer öncelik depoları": item.stock_data?.sFarkliDepo === undefined ? "Veri yok" : item.stock_data.sFarkliDepo > 0 ? "Stok var" : "Stok yok" }}/>
          <Separator/>
          <h3 className="font-medium">Depo stokları</h3>
          <Fields values={Object.fromEntries(basbugWarehouses.map(depot => [warehouseNames[depot] ? `${warehouseNames[depot]} (${depot})` : depot, `${basbugStockLabel(basbugWarehouseStock(item.stock_data, depot))}${(item.stock_data?.depolar?.[depot]?.sYol ?? (depot === "MRK" ? item.stock_data?.sYol : 0) ?? 0) > 0 ? " · Yolda" : ""}`]))}/>
          <p className="text-muted-foreground">“Veri yok”, stok yanıtı alınmayan veya hesabın erişemediği depoları belirtir.</p>
        </CardContent>
      </Card>
    </div>
    <Card>
      <CardHeader>
        <CardTitle><h2>Getirbakim satış fiyatı</h2></CardTitle>
        <CardAction className="flex flex-wrap gap-1">
          <Button variant="link" size="sm" nativeButton={false} render={<Link href="/yonetim/fiyatlandirma"/>}>Kâr ve KDV oranları<ArrowRight data-icon="inline-end" aria-hidden="true"/></Button>
          {sale && <Button variant="link" size="sm" nativeButton={false} render={<Link href={`/urun/${sale.id}`}/>}>Katalogda aç<ArrowRight data-icon="inline-end" aria-hidden="true"/></Button>}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <p className="text-2xl font-semibold tabular-nums">{sale?.price_kurus ? money(sale.price_kurus) : "Güncel fiyat bulunamadı"}</p>
        <p className="text-muted-foreground">KDV dahil · {sale?.stock_label ?? "Satışa kapalı"}</p>
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle><h2>Değişiklik geçmişi</h2></CardTitle><CardDescription>Son 90 gün içindeki en son 20 değişiklik gösterilir. Değişmeyen çekimler yeni geçmiş satırı oluşturmaz.</CardDescription></CardHeader>
      <CardContent>
        {item.changes.length ? <div className="flex flex-col gap-2">{item.changes.map((change, index) => <Collapsible key={change.id} className="flex flex-col gap-2">
          {index > 0 && <Separator/>}
          <div className="flex flex-wrap items-center gap-2">
            <CollapsibleTrigger render={<Button variant="ghost" size="sm"/>}><ChevronsUpDown data-icon="inline-start" aria-hidden="true"/><span className="tabular-nums">{date(change.changed_at)}</span></CollapsibleTrigger>
            {statusBadge(change.kind === "added" || change.kind === "restored" ? "success" : change.kind === "changed" ? "info" : "warning", changeKinds[change.kind])}
          </div>
          <CollapsibleContent><Json label={`${date(change.changed_at)} değişiklik kaydı`} value={{ önce: change.before_data, sonra: change.after_data }}/></CollapsibleContent>
        </Collapsible>)}</div> : <Empty><EmptyHeader><EmptyMedia variant="icon"><History/></EmptyMedia><EmptyTitle>Kayıtlı değişiklik yok</EmptyTitle></EmptyHeader></Empty>}
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle><h2>Veri kontrolü</h2></CardTitle>{item.conflicting && <CardAction>{statusBadge("warning", "İnceleme gerekli")}</CardAction>}</CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p>Kaynak satır sayısı — Ürün: {item.product_count}, fiyat: {item.price_count}, stok: {item.stock_count}.</p>
        <p className="text-muted-foreground">{item.conflicting ? "Aynı kod için farklı yanıtlar bulundu. Kayıt inceleme gerektiriyor; farklı kaynak değerleri aşağıda saklanıyor." : "Bu kayıt için çelişkili tekrar bulunmadı."}</p>
        <Collapsible>
          <CollapsibleTrigger render={<Button variant="link" size="sm"/>}><ChevronsUpDown data-icon="inline-start" aria-hidden="true"/>Kaynak alanlarını göster</CollapsibleTrigger>
          <CollapsibleContent><Json label="Kaynak alanları" value={{ product: item.product_data, price: item.price_data, stock: item.stock_data, conflictingVariants: item.source_variants }}/></CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  </div>;
}
