import { notFound } from "next/navigation";
import { adminSetaItem } from "@/modules/admin/seta";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Fields, SupplierProductDetail, SupplierStocks, Timestamp } from "@/components/admin/supplier-product-detail";
import { formatExact } from "@/modules/admin/format";

/** Body of the SETA product page; also opened in a dialog over the list (modal). */
export async function SetaItemDetail({ id, modal = false }: { id: string; modal?: boolean }) {
  const item = await adminSetaItem(id);
  if (!item) notFound();
  const p = item.product_data;
  const { sale, pricing } = item;
  const cross = Object.entries(p.cross ?? {});
  const stock = item.stock_data?.stok;
  return <SupplierProductDetail item={item} modal={modal} cart={p.ac || "Ürün adı bulunamadı"} supplier="SETA"
    listHref={`/yonetim/tedarikciler/seta${p.source_category ? `?category=${encodeURIComponent(p.source_category)}` : ""}`}
    description={<>{p.ac || "Ürün adı bulunamadı"} · {p.uk || "Üretici belirtilmemiş"}</>}
    sale={sale} pricing={pricing} cost={item.price_data?.nf ?? null} sourcePriceLabel="Kaynak bayi fiyatı (NF)"
    productInfo={<Card><CardHeader><CardTitle><h2>Ürün bilgileri</h2></CardTitle><CardDescription>Araç ve çapraz referans alanları kaynak metinlerdir; doğrulanmış araç uyumluluğu değildir.</CardDescription></CardHeader><CardContent>
      <Fields values={{ Üretici: p.uk, "OEM referansları": p.oe, "Araç markası (kaynak)": p.vehicle_brand, "Araç / açıklama": p.ac2, "Kategori (kaynak)": p.source_category }}/>
      <Card size="sm" className="mt-4 py-0"><CardContent><Accordion><AccordionItem value="more">
        <AccordionTrigger>Çapraz referanslar ({cross.length})</AccordionTrigger>
        <AccordionContent>{cross.length ? <Fields values={Object.fromEntries(cross.map(([brand, code]) => [brand || "Belirtilmemiş", code]))}/> : <p className="text-muted-foreground">Çapraz referans bulunmuyor.</p>}</AccordionContent>
      </AccordionItem></Accordion></CardContent></Card>
    </CardContent></Card>}
    stockInfo={<Card><CardHeader><CardTitle><h2>Kaynak stokları</h2></CardTitle><CardDescription>Var / Yok, tedarikçinin stok bayrağıdır; adet veya satış teyidi değildir.</CardDescription></CardHeader><CardContent>
      <SupplierStocks stocks={[{ label: "SETA", available: stock === undefined ? null : stock > 0 }]}/>
      <p className="mt-3 text-xs text-muted-foreground">SETA depo veya stok adedi bildirmez. “Veri yok”, stok satırı bulunmadığını belirtir.</p>
    </CardContent></Card>}
    dataInfo={<div className="grid min-w-0 gap-4 xl:grid-cols-2">
      <Fields values={{ "İlk görülme": <Timestamp value={item.first_seen_at}/>, "Son değişim": <Timestamp value={item.changed_at}/>, "Ürün satırı": formatExact(item.product_count), "Fiyat satırı": formatExact(item.price_count), "Stok satırı": formatExact(item.stock_count) }} numeric={["Ürün satırı", "Fiyat satırı", "Stok satırı"]}/>
      <div className="min-w-0">
        <Fields values={{ "Para birimi": p.dc, "Kaynak fiyat metni": item.price_data?.price, "Görsel adresi": p.image }}/>
        <p className="mt-3 text-xs text-muted-foreground">NF, KDV hariç bayi alış fiyatıdır. 0,00 TL maliyetli ürünler satışa kapalıdır. Tüm tarihler İstanbul saatindedir.</p>
      </div>
    </div>}/>;
}
