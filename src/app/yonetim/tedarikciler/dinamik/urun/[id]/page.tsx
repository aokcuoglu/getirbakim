import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronRight, ExternalLink, History } from "lucide-react";
import { getProduct, money } from "@/modules/store/catalog";
import { adminDinamikItem } from "@/modules/admin/dinamik";
import { supplierFieldChanges } from "@/modules/admin/supplier-changes";
import { dinamikRegions, dinamikRegionStock } from "@/modules/suppliers/dinamik-stock";
import { AdminColumns, AdminPage, AdminPageHeader, AdminPanel, ButtonLink, EmptyState, StatusBadge, StatusMessage, TableRegion } from "@/components/admin/ui";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

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
const disclosure = "group flex min-h-11 w-full items-center gap-2 rounded-sm text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
const chevron = "size-4 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-90 motion-reduce:transition-none";

function Timestamp({ value }: { value: Date }) {
  return <time dateTime={value.toISOString()} className="tabular-nums">{date(value)}</time>;
}

function Fields({ values, numeric = [] }: { values: Record<string, ReactNode>; numeric?: string[] }) {
  return <dl className="divide-y text-sm">{Object.entries(values).map(([key, value]) => <div key={key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-3 py-2 first:pt-0 last:pb-0">
    <dt className="min-w-0 text-muted-foreground">{key}</dt>
    <dd className={cn("min-w-0 wrap-anywhere tabular-nums", numeric.includes(key) && "text-right")}>{value === null || value === undefined || value === "" ? "—" : value}</dd>
  </div>)}</dl>;
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
  return <Collapsible className="mt-3 min-w-0">
    <CollapsibleTrigger className={disclosure}><ChevronRight className={chevron} aria-hidden="true"/>{label}</CollapsibleTrigger>
    <CollapsibleContent>
      <TableRegion label={label} className="mt-2 max-h-80 rounded-sm border bg-muted/40 p-3">
        <pre className="w-max min-w-full font-mono text-xs leading-5">{JSON.stringify(value, null, 2)}</pre>
      </TableRegion>
    </CollapsibleContent>
  </Collapsible>;
}

export default async function DinamikItem({ params }: { params: Promise<{ id: string }> }) {
  const item = await adminDinamikItem((await params).id);
  if (!item) notFound();
  const p = item.product_data;
  const sale = await getProduct(item.id);
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

  return <AdminPage>
    <AdminPageHeader
      breadcrumbs={[{ label: "Yönetim", href: "/yonetim" }, { label: "Tedarikçiler", href: "/yonetim/tedarikciler" }, { label: "Dinamik", href: listHref }, { label: item.code }]}
      title={<span className="wrap-anywhere font-mono">{item.code}</span>}
      description={<>{p.stokAdi || "Yalnız fiyat listesinde — ürün bilgisi yok"} · {item.list_group}</>}
      actions={<ButtonLink href={listHref} className="min-h-11"><ArrowLeft aria-hidden="true"/>Ürün listesine dön</ButtonLink>}/>

    <AdminPanel title="Fiyat ve satış durumu" footer={<>
      <ButtonLink href="/yonetim/fiyatlandirma" className="min-h-11 w-full sm:w-auto">Kâr ve KDV oranları</ButtonLink>
      {sale && <ButtonLink href={`/urun/${sale.id}`} variant="default" className="min-h-11 w-full sm:w-auto">Katalogda aç<ExternalLink aria-hidden="true"/></ButtonLink>}
    </>}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 xl:grid-cols-3">
        <div className="min-w-0"><dt className="text-sm text-muted-foreground">Getirbakim satış fiyatı</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{sale?.price_kurus ? money(sale.price_kurus) : "—"}</dd><dd className="mt-1 text-xs text-muted-foreground">KDV dahil</dd></div>
        <div className="min-w-0"><dt className="text-sm text-muted-foreground">Kaynak liste fiyatı</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{typeof price === "number" ? money(Math.round(price * 100)) : "—"}</dd><dd className="mt-1 text-xs text-muted-foreground">KDV hariç maliyet</dd></div>
        <div className="col-span-2 min-w-0 border-t pt-3 xl:col-span-1 xl:border-t-0 xl:border-l xl:pl-4 xl:pt-0">
          <dt className="text-sm text-muted-foreground">Satış durumu</dt>
          <dd className="mt-2"><StatusBadge tone={sale?.available && !snapshot ? "success" : "warning"}>{saleState}</StatusBadge></dd>
          <dd className="mt-2 text-sm text-muted-foreground">{sale?.stock_label ?? (item.stock_data ? "Bu kayıt için mağazada satış bilgisi bulunamadı." : "Stok listesinde ürün bilgisi yok; mağazada gösterilmiyor.")}</dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
        <StatusBadge tone={item.presence === "present" ? "success" : "warning"}>{presence}</StatusBadge>
        <span>Son görülme: <Timestamp value={item.last_seen_at}/> · İstanbul saati</span>
      </div>
    </AdminPanel>

    {item.conflicting && <StatusMessage tone="warning" title="Kaynak verisi inceleme gerektiriyor">Aynı ürün kodu için çelişkili değerler bulundu. Farklı yanıtları veri kontrolü bölümünde inceleyebilirsiniz.</StatusMessage>}

    <AdminColumns>
      <AdminPanel title="Ürün bilgileri" description="Araç markası ve grup alanları kaynak metinlerdir; doğrulanmış araç uyumluluğu değildir.">
        <Fields values={{ Üretici: p.kull3s || p.marka, "Araç markası (kaynak)": p.kull1s, "Ürün grubu": p.kull7s, "Ürün tipi": p.kull8s,
          Barkod: [p.barkod1, p.barkod2, p.barkod3].filter(Boolean).join(", "),
          "Paket miktarı": p.paketMiktari !== undefined ? `${number(p.paketMiktari)}${unit}` : null,
          "Koli miktarı": p.koliMiktari !== undefined ? `${number(p.koliMiktari)}${unit}` : null,
          Desi: typeof p.desi === "number" ? number(p.desi) : null,
        }} numeric={["Paket miktarı", "Koli miktarı", "Desi"]}/>
        <Collapsible className="mt-3 border-t pt-2">
          <CollapsibleTrigger className={disclosure}><ChevronRight className={chevron} aria-hidden="true"/>Diğer ürün alanları</CollapsibleTrigger>
          <CollapsibleContent className="pt-2"><Fields values={{ "İngilizce adı": p.ingilizceAdi, "OEM listesi": p.oemListe, "Eşdeğer listesi": p.esdegerListe, "Görsel adresi": p.resimUrl }}/></CollapsibleContent>
        </Collapsible>
      </AdminPanel>
      <AdminPanel title="Kaynak stokları" description="Var / Yok, tedarikçinin stok bayrağıdır; adet veya satış teyidi değildir.">
        {item.stock_data ? <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">{stocks.map(stock => <div key={stock.label} className="min-w-0 border-b pb-3">
          <dt className="mb-2 text-sm text-muted-foreground">{stock.label}</dt>
          <dd><StatusBadge tone={stock.available === null ? "warning" : stock.available ? "success" : "neutral"}>{stock.available === null ? "Veri yok" : stock.available ? "Var" : "Yok"}</StatusBadge></dd>
        </div>)}</dl> : <EmptyState title="Stok satırı bulunamadı">Bu kod yalnız fiyat listesinde. Bölge stokları bilinmiyor.</EmptyState>}
      </AdminPanel>
    </AdminColumns>

    <AdminPanel title="Değişiklik geçmişi" description="Son 90 gün içindeki en son 20 kayıt. Önce yalnız değişen alanlar gösterilir; ham kayıtlar ayrıntılarda korunur." flush>
      {item.changes.length ? <div className="divide-y">{item.changes.map(change => {
        const changes = supplierFieldChanges(change.before_data, change.after_data);
        return <Collapsible key={change.id}>
          <CollapsibleTrigger className={cn(disclosure, "flex-wrap px-4 py-3 hover:bg-muted/50 focus-visible:ring-inset")}>
            <ChevronRight className={chevron} aria-hidden="true"/>
            <span className="min-w-0 flex-1"><Timestamp value={change.changed_at}/></span>
            <StatusBadge tone={change.kind === "added" || change.kind === "restored" ? "success" : change.kind === "changed" ? "info" : "warning"}>{changeKinds[change.kind] ?? change.kind}</StatusBadge>
          </CollapsibleTrigger>
          <CollapsibleContent className="min-w-0 border-t px-4 py-3">
            {changes.length ? <TableRegion label={`${date(change.changed_at)} değişen alanlar`} className="max-h-80 rounded-sm border">
              <table className="admin-table w-full min-w-[28rem] table-fixed text-sm">
                <thead className="sticky top-0 bg-muted"><tr className="border-b text-left"><th scope="col" className="w-2/5 p-3 font-medium">Alan</th><th scope="col" className="p-3 font-medium">Önce</th><th scope="col" className="p-3 font-medium">Sonra</th></tr></thead>
                <tbody>{changes.map(field => <tr key={JSON.stringify(field.path)} className="border-b last:border-b-0 even:bg-muted/30 hover:bg-muted/50">
                  <th scope="row" className="wrap-anywhere p-3 text-left align-top font-medium">{field.path.map(key => fieldNames[key] ?? key).join(" · ") || "Kayıt"}</th>
                  <td className="wrap-anywhere p-3 align-top"><ChangeValue value={field.before} path={field.path}/></td>
                  <td className="wrap-anywhere p-3 align-top"><ChangeValue value={field.after} path={field.path}/></td>
                </tr>)}</tbody>
              </table>
            </TableRegion> : <p className="text-sm text-muted-foreground">Ürün, fiyat ve stok alanlarında fark yok; kayıt durumu değişti.</p>}
            <SourceJson label="Ham geçmiş kaydını göster" value={{ önce: change.before_data, sonra: change.after_data }}/>
          </CollapsibleContent>
        </Collapsible>;
      })}</div> : <EmptyState title="Kayıtlı değişiklik yok" icon={<History/>}/>}
    </AdminPanel>

    <AdminPanel title="Veri kontrolü" description="Kaynak tarihler, fiyat karşılaştırması ve ham API alanları." actions={<StatusBadge tone={item.conflicting ? "warning" : "neutral"}>{item.conflicting ? "İnceleme gerekli" : "Çelişki bulunmadı"}</StatusBadge>}>
      <AdminColumns>
        <Fields values={{ "İlk görülme": <Timestamp value={item.first_seen_at}/>, "Son değişim": <Timestamp value={item.changed_at}/>, "Fiyat satırı": number(item.price_count), "Stok satırı": number(item.stock_count) }} numeric={["Fiyat satırı", "Stok satırı"]}/>
        <div className="min-w-0">
          <Fields values={{ "Kampanya alanı": item.price_data?.kampanyaOrani !== undefined ? number(item.price_data.kampanyaOrani) : null,
            "Stok listesi fiyatı": !item.stock_data ? "Stok satırı yok" : typeof item.source_variants.stockListPrice === "number" ? `${money(Math.round(item.source_variants.stockListPrice * 100))} · fiyat listesiyle farklı` : "Fiyat listesiyle aynı",
          }} numeric={["Kampanya alanı"]}/>
          <p className="mt-3 text-xs text-muted-foreground">Kampanya alanının anlamı doğrulanmadı; satış fiyatına uygulanmaz. Tüm tarihler İstanbul saatindedir.</p>
        </div>
      </AdminColumns>
      <SourceJson label="Kaynak alanlarını göster" value={{ product: item.product_data, price: item.price_data, stock: item.stock_data, conflictingVariants: item.source_variants }}/>
    </AdminPanel>
  </AdminPage>;
}
