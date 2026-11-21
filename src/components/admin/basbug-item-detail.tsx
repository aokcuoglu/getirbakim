import { notFound } from "next/navigation";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { adminBasbugItem } from "@/modules/admin/basbug";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { basbugWarehouses, basbugWarehouseStock } from "@/modules/suppliers/basbug-stock";
import { Fields, SupplierProductDetail, SupplierStocks, Timestamp, sourceMoney } from "@/components/admin/supplier-product-detail";
import { formatExact } from "@/modules/admin/format";
import { priceAnomalySummary } from "@/components/admin/supplier-price-anomalies";

const warehouseNames: Record<string, string> = { MRK: "Merkez", IZM: "İzmir" };
const stockFlag = (value: number | undefined) => value === undefined ? null : value > 0;

/** Body of the Başbuğ product page; also opened in a dialog over the list (modal). */
export async function BasbugItemDetail({ id, modal = false }: { id: string; modal?: boolean }) {
  const item = await adminBasbugItem(id);
  if (!item) notFound();
  const p = item.product_data;
  const { sale, pricing } = item;
  const stocks = basbugWarehouses.map(depot => {
    const value = basbugWarehouseStock(item.stock_data, depot);
    const onWay = item.stock_data?.depolar?.[depot]?.sYol ?? (depot === "MRK" ? item.stock_data?.sYol : undefined);
    return { label: warehouseNames[depot] ? `${warehouseNames[depot]} (${depot})` : depot, available: value === null ? null : value > 0, note: onWay === undefined ? "Veri yok" : onWay > 0 ? "Var" : "Yok" };
  });
  return <SupplierProductDetail item={item} modal={modal} cart={p.ac || "Ürün adı bulunamadı"} supplier="Başbuğ"
    listHref={`/yonetim/tedarikciler/basbug?group=${encodeURIComponent(item.list_group)}`}
    description={<>{p.ac || "Ürün adı bulunamadı"} · {p.uk || "Üretici belirtilmemiş"} · {item.list_group} / {item.warehouse}</>}
    sale={sale} pricing={pricing} cost={item.price_data?.nf ?? null} sourcePriceLabel="Kaynak bayi fiyatı (NF)"
    notice={item.anomaly?.status === "open" && <Alert variant="warning"><TriangleAlert aria-hidden="true"/>
      <AlertTitle>Fiyat anomalisi: bu teklif fiyatlanmıyor</AlertTitle>
      <AlertDescription>{priceAnomalySummary(item.anomaly.kind, item.anomaly.evidence)} Tedarikçi veriyi düzeltince ya da <Link href="/yonetim/tedarikciler#fiyat-anomalileri" className="underline underline-offset-4">tedarikçi sayfasında</Link> “Anomali değil” işaretlenince yeniden fiyatlanır.</AlertDescription></Alert>}
    noSaleMessage={item.warehouse !== "MRK" ? "Mağazada yalnız merkez depo kayıtları satışa sunulur." : undefined}
    productInfo={<Card><CardHeader><CardTitle><h2>Ürün bilgileri</h2></CardTitle><CardDescription>Model, motor ve yıl alanları kaynak metinlerdir; doğrulanmış araç uyumluluğu değildir.</CardDescription></CardHeader><CardContent>
      <Fields values={{ Üretici: p.uk, "OEM referansları": p.oe, "Model açıklaması": p.m, "Motor açıklaması": p.mo, "Yıl açıklaması": p.y, Birim: p.b }}/>
      <Card size="sm" className="mt-4 py-0"><CardContent><Accordion><AccordionItem value="more">
        <AccordionTrigger>Diğer ürün alanları</AccordionTrigger>
        <AccordionContent><Fields values={{ "Ek açıklama": p.ac2, "Liste grubu": p.lgk, "MKK (kaynak)": p.mkk }}/></AccordionContent>
      </AccordionItem></Accordion></CardContent></Card>
    </CardContent></Card>}
    stockInfo={<Card><CardHeader><CardTitle><h2>Kaynak stokları</h2></CardTitle><CardDescription>Var / Yok, tedarikçinin stok sinyalidir; adet veya satış teyidi değildir.</CardDescription></CardHeader><CardContent>
      {item.stock_data ? <>
        <SupplierStocks stocks={[...stocks, { label: "Diğer öncelik depoları", available: stockFlag(item.stock_data.sFarkliDepo) }]}/>
        <p className="mt-3 text-xs text-muted-foreground">“Veri yok”, stok yanıtı alınmayan veya hesabın erişemediği depoları belirtir. Yolda bilgisi mevcut stok anlamına gelmez.</p>
      </> : <Empty><EmptyHeader><EmptyTitle>Stok satırı bulunamadı</EmptyTitle><EmptyDescription>Depo stokları bilinmiyor.</EmptyDescription></EmptyHeader></Empty>}
    </CardContent></Card>}
    dataInfo={<div className="grid min-w-0 gap-4 xl:grid-cols-2">
      <Fields values={{ "İlk görülme": <Timestamp value={item.first_seen_at}/>, "Son değişim": <Timestamp value={item.changed_at}/>, "Ürün satırı": formatExact(item.product_count), "Fiyat satırı": formatExact(item.price_count), "Stok satırı": formatExact(item.stock_count) }} numeric={["Ürün satırı", "Fiyat satırı", "Stok satırı"]}/>
      <div className="min-w-0">
        <Fields values={{ "Para birimi": p.dc, "Liste fiyatı (LF)": typeof p.lf === "number" ? sourceMoney(p.lf, p.dc) : null, "MIF (kaynak)": item.price_data?.mif === undefined ? null : formatExact(item.price_data.mif), "K (kaynak)": item.price_data?.k === undefined ? null : formatExact(item.price_data.k), "Çekim deposu": item.warehouse }} numeric={["Liste fiyatı (LF)", "MIF (kaynak)", "K (kaynak)"]}/>
        <p className="mt-3 text-xs text-muted-foreground">Satış fiyatı NF ve kayıtlı kur üzerinden hesaplanır. LF, MIF ve K alanları satış hesaplamasında kullanılmaz. Tüm tarihler İstanbul saatindedir.</p>
      </div>
    </div>}/>;
}
