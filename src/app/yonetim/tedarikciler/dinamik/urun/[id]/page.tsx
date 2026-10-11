import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { getProduct, money } from "@/modules/store/catalog";
import { adminDinamikItem } from "@/modules/admin/dinamik";
import { adminProductPricing } from "@/modules/admin/product-pricing";
import { dinamikRegions, dinamikRegionStock } from "@/modules/suppliers/dinamik-stock";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Fields, SupplierProductDetail, SupplierStocks, Timestamp, supplierNumber, supplierDisclosure, supplierChevron } from "@/components/admin/supplier-product-detail";

export default async function DinamikItem({ params }: { params: Promise<{ id: string }> }) {
  const item = await adminDinamikItem((await params).id);
  if (!item) notFound();
  const p = item.product_data;
  const [sale, pricing] = await Promise.all([getProduct(item.id), adminProductPricing(item.id)]);
  const listHref = `/yonetim/tedarikciler/dinamik?brand=${encodeURIComponent(item.list_group)}`;
  const price = item.price_data?.fiyat;
  const unit = p.olcuBirimi ? ` ${p.olcuBirimi}` : "";
  const kaporta = item.stock_data?.kaporta?.trim().toUpperCase();
  const stocks = [
    ...dinamikRegions.map(region => ({ label: region.label, available: dinamikRegionStock(item.stock_data, region.key) })),
    { label: "Kaporta", available: kaporta === "VAR" ? true : kaporta === "YOK" ? false : null },
  ];

  return <SupplierProductDetail item={item} supplier="Dinamik" listHref={listHref}
    description={<>{p.stokAdi || "Yalnız fiyat listesinde — ürün bilgisi yok"} · {item.list_group}</>}
    sale={sale} pricing={pricing} cost={typeof price === "number" ? price : null}
    productInfo={<Card className="rounded-[4px] border ring-0"><CardHeader><CardTitle><h2>Ürün bilgileri</h2></CardTitle><CardDescription>Araç markası ve grup alanları kaynak metinlerdir; doğrulanmış araç uyumluluğu değildir.</CardDescription></CardHeader><CardContent>
        <Fields values={{ Üretici: p.kull3s || p.marka, "Araç markası (kaynak)": p.kull1s, "Ürün grubu": p.kull7s, "Ürün tipi": p.kull8s,
          Barkod: [p.barkod1, p.barkod2, p.barkod3].filter(Boolean).join(", "),
          "Paket miktarı": p.paketMiktari !== undefined ? `${supplierNumber(p.paketMiktari)}${unit}` : null,
          "Koli miktarı": p.koliMiktari !== undefined ? `${supplierNumber(p.koliMiktari)}${unit}` : null,
          Desi: typeof p.desi === "number" ? supplierNumber(p.desi) : null,
        }} numeric={["Paket miktarı", "Koli miktarı", "Desi"]}/>
        <Collapsible className="mt-3 border-t pt-2">
          <CollapsibleTrigger className={supplierDisclosure}><ChevronRight className={supplierChevron} aria-hidden="true"/>Diğer ürün alanları</CollapsibleTrigger>
          <CollapsibleContent className="pt-2"><Fields values={{ "İngilizce adı": p.ingilizceAdi, "OEM listesi": p.oemListe, "Eşdeğer listesi": p.esdegerListe, "Görsel adresi": p.resimUrl }}/></CollapsibleContent>
        </Collapsible>
      </CardContent></Card>}
    stockInfo={<Card className="rounded-[4px] border ring-0"><CardHeader><CardTitle><h2>Kaynak stokları</h2></CardTitle><CardDescription>Var / Yok, tedarikçinin stok bayrağıdır; adet veya satış teyidi değildir.</CardDescription></CardHeader><CardContent>
      {item.stock_data ? <SupplierStocks stocks={stocks}/> : <Empty><EmptyHeader><EmptyTitle>Stok satırı bulunamadı</EmptyTitle><EmptyDescription>Bu kod yalnız fiyat listesinde. Bölge stokları bilinmiyor.</EmptyDescription></EmptyHeader></Empty>}
    </CardContent></Card>}
    dataInfo={<div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <Fields values={{ "İlk görülme": <Timestamp value={item.first_seen_at}/>, "Son değişim": <Timestamp value={item.changed_at}/>, "Fiyat satırı": supplierNumber(item.price_count), "Stok satırı": supplierNumber(item.stock_count) }} numeric={["Fiyat satırı", "Stok satırı"]}/>
        <div className="min-w-0">
          <Fields values={{ "Kampanya alanı": item.price_data?.kampanyaOrani !== undefined ? supplierNumber(item.price_data.kampanyaOrani) : null,
            "Stok listesi fiyatı": !item.stock_data ? "Stok satırı yok" : typeof item.source_variants.stockListPrice === "number" ? `${money(Math.round(item.source_variants.stockListPrice * 100))} · fiyat listesiyle farklı` : "Fiyat listesiyle aynı",
          }} numeric={["Kampanya alanı"]}/>
          <p className="mt-3 text-xs text-muted-foreground">Kampanya alanının anlamı doğrulanmadı; satış fiyatına uygulanmaz. Tüm tarihler İstanbul saatindedir.</p>
        </div>
      </div>}/>;
}
