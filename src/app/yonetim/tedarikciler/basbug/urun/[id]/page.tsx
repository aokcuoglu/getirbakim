import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { getProduct } from "@/modules/store/catalog";
import { adminBasbugItem } from "@/modules/admin/basbug";
import { adminProductPricing } from "@/modules/admin/product-pricing";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { basbugWarehouses, basbugWarehouseStock } from "@/modules/suppliers/basbug-stock";
import { Fields, SupplierProductDetail, SupplierStocks, Timestamp, sourceMoney, supplierNumber, supplierDisclosure, supplierChevron } from "@/components/admin/supplier-product-detail";

const warehouseNames: Record<string, string> = { MRK: "Merkez", IZM: "İzmir" };
const stockFlag = (value: number | undefined) => value === undefined ? null : value > 0;

export default async function BasbugItem({ params }: { params: Promise<{ id: string }> }) {
  const item = await adminBasbugItem((await params).id);
  if (!item) notFound();
  const p = item.product_data;
  const [sale, pricing] = await Promise.all([getProduct(item.id), adminProductPricing(item.id)]);
  const stocks = basbugWarehouses.map(depot => {
    const value = basbugWarehouseStock(item.stock_data, depot);
    const onWay = item.stock_data?.depolar?.[depot]?.sYol ?? (depot === "MRK" ? item.stock_data?.sYol : undefined);
    return { label: warehouseNames[depot] ? `${warehouseNames[depot]} (${depot})` : depot, available: value === null ? null : value > 0, note: onWay === undefined ? "Yolda: veri yok" : onWay > 0 ? "Yolda: var" : "Yolda: yok" };
  });
  return <SupplierProductDetail item={item} supplier="Başbuğ"
    listHref={`/yonetim/tedarikciler/basbug?group=${encodeURIComponent(item.list_group)}`}
    description={<>{p.ac || "Ürün adı bulunamadı"} · {p.uk || "Üretici belirtilmemiş"} · {item.list_group} / {item.warehouse}</>}
    sale={sale} pricing={pricing} cost={item.price_data?.nf ?? null} sourcePriceLabel="Kaynak bayi fiyatı (NF)"
    noSaleMessage={item.warehouse !== "MRK" ? "Mağazada yalnız merkez depo kayıtları satışa sunulur." : undefined}
    productInfo={<Card className="rounded-[4px] border ring-0"><CardHeader><CardTitle><h2>Ürün bilgileri</h2></CardTitle><CardDescription>Model, motor ve yıl alanları kaynak metinlerdir; doğrulanmış araç uyumluluğu değildir.</CardDescription></CardHeader><CardContent>
      <Fields values={{ Üretici: p.uk, "OEM referansları": p.oe, "Model açıklaması": p.m, "Motor açıklaması": p.mo, "Yıl açıklaması": p.y, Birim: p.b }}/>
      <Collapsible className="mt-3 border-t pt-2">
        <CollapsibleTrigger className={supplierDisclosure}><ChevronRight className={supplierChevron} aria-hidden="true"/>Diğer ürün alanları</CollapsibleTrigger>
        <CollapsibleContent className="pt-2"><Fields values={{ "Ek açıklama": p.ac2, "Liste grubu": p.lgk, "MKK (kaynak)": p.mkk }}/></CollapsibleContent>
      </Collapsible>
    </CardContent></Card>}
    stockInfo={<Card className="rounded-[4px] border ring-0"><CardHeader><CardTitle><h2>Kaynak stokları</h2></CardTitle><CardDescription>Var / Yok, tedarikçinin stok sinyalidir; adet veya satış teyidi değildir.</CardDescription></CardHeader><CardContent>
      {item.stock_data ? <>
        <SupplierStocks stocks={[...stocks, { label: "Diğer öncelik depoları", available: stockFlag(item.stock_data.sFarkliDepo) }]}/>
        <p className="mt-3 text-xs text-muted-foreground">“Veri yok”, stok yanıtı alınmayan veya hesabın erişemediği depoları belirtir. Yolda bilgisi mevcut stok anlamına gelmez.</p>
      </> : <Empty><EmptyHeader><EmptyTitle>Stok satırı bulunamadı</EmptyTitle><EmptyDescription>Depo stokları bilinmiyor.</EmptyDescription></EmptyHeader></Empty>}
    </CardContent></Card>}
    dataInfo={<div className="grid min-w-0 gap-4 xl:grid-cols-2">
      <Fields values={{ "İlk görülme": <Timestamp value={item.first_seen_at}/>, "Son değişim": <Timestamp value={item.changed_at}/>, "Ürün satırı": supplierNumber(item.product_count), "Fiyat satırı": supplierNumber(item.price_count), "Stok satırı": supplierNumber(item.stock_count) }} numeric={["Ürün satırı", "Fiyat satırı", "Stok satırı"]}/>
      <div className="min-w-0">
        <Fields values={{ "Para birimi": p.dc, "Liste fiyatı (LF)": typeof p.lf === "number" ? sourceMoney(p.lf, p.dc) : null, "MIF (kaynak)": item.price_data?.mif === undefined ? null : supplierNumber(item.price_data.mif), "K (kaynak)": item.price_data?.k === undefined ? null : supplierNumber(item.price_data.k), "Çekim deposu": item.warehouse }} numeric={["Liste fiyatı (LF)", "MIF (kaynak)", "K (kaynak)"]}/>
        <p className="mt-3 text-xs text-muted-foreground">Satış fiyatı NF ve kayıtlı kur üzerinden hesaplanır. LF, MIF ve K alanları satış hesaplamasında kullanılmaz. Tüm tarihler İstanbul saatindedir.</p>
      </div>
    </div>}/>;
}
