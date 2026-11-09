import { notFound } from "next/navigation";
import { getProduct } from "@/modules/store/catalog";
import { adminSetaItem } from "@/modules/admin/seta";
import { adminProductPricing } from "@/modules/admin/product-pricing";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Fields, SupplierProductDetail, SupplierStocks, Timestamp, supplierNumber } from "@/components/admin/supplier-product-detail";

export default async function SetaItem({ params }: { params: Promise<{ id: string }> }) {
  const item = await adminSetaItem((await params).id);
  if (!item) notFound();
  const p = item.product_data;
  const [sale, pricing] = await Promise.all([getProduct(item.id), adminProductPricing(item.id)]);
  const cross = Object.entries(p.cross ?? {});
  const stock = item.stock_data?.stok;
  return <SupplierProductDetail item={item} supplier="SETA"
    listHref={`/yonetim/tedarikciler/seta${p.source_category ? `?category=${encodeURIComponent(p.source_category)}` : ""}`}
    description={<>{p.ac || "Ürün adı bulunamadı"} · {p.uk || "Üretici belirtilmemiş"}</>}
    sale={sale} pricing={pricing} cost={item.price_data?.nf ?? null} sourcePriceLabel="Kaynak bayi fiyatı (NF)"
    productInfo={<Card><CardHeader><CardTitle><h2>Ürün bilgileri</h2></CardTitle><CardDescription>Araç ve çapraz referans alanları kaynak metinlerdir; doğrulanmış araç uyumluluğu değildir.</CardDescription></CardHeader><CardContent>
      <Fields values={{ Üretici: p.uk, "OEM referansları": p.oe, "Araç markası (kaynak)": p.vehicle_brand, "Araç / açıklama": p.ac2, "Kategori (kaynak)": p.source_category }}/>
      <Accordion className="mt-4 rounded-lg border"><AccordionItem value="more" className="px-4">
        <AccordionTrigger>Çapraz referanslar ({cross.length})</AccordionTrigger>
        <AccordionContent>{cross.length ? <Fields values={Object.fromEntries(cross.map(([brand, code]) => [brand || "Belirtilmemiş", code]))}/> : <p className="text-muted-foreground">Çapraz referans bulunmuyor.</p>}</AccordionContent>
      </AccordionItem></Accordion>
    </CardContent></Card>}
    stockInfo={<Card><CardHeader><CardTitle><h2>Kaynak stokları</h2></CardTitle><CardDescription>Var / Yok, tedarikçinin stok bayrağıdır; adet veya satış teyidi değildir.</CardDescription></CardHeader><CardContent>
      <SupplierStocks stocks={[{ label: "SETA", available: stock === undefined ? null : stock > 0 }]}/>
      <p className="mt-3 text-xs text-muted-foreground">SETA depo veya stok adedi bildirmez. “Veri yok”, stok satırı bulunmadığını belirtir.</p>
    </CardContent></Card>}
    dataInfo={<div className="grid min-w-0 gap-4 xl:grid-cols-2">
      <Fields values={{ "İlk görülme": <Timestamp value={item.first_seen_at}/>, "Son değişim": <Timestamp value={item.changed_at}/>, "Ürün satırı": supplierNumber(item.product_count), "Fiyat satırı": supplierNumber(item.price_count), "Stok satırı": supplierNumber(item.stock_count) }} numeric={["Ürün satırı", "Fiyat satırı", "Stok satırı"]}/>
      <div className="min-w-0">
        <Fields values={{ "Para birimi": p.dc, "Kaynak fiyat metni": item.price_data?.price, "Görsel adresi": p.image }}/>
        <p className="mt-3 text-xs text-muted-foreground">NF, KDV hariç bayi alış fiyatıdır. 0,00 TL maliyetli ürünler satışa kapalıdır. Tüm tarihler İstanbul saatindedir.</p>
      </div>
    </div>}/>;
}
