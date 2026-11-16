import { notFound } from "next/navigation";
import { money } from "@/modules/store/catalog";
import { adminDinamikItem } from "@/modules/admin/dinamik";
import { dinamikRegions, dinamikRegionStock } from "@/modules/suppliers/dinamik-stock";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Fields, SupplierProductDetail, SupplierStocks, Timestamp } from "@/components/admin/supplier-product-detail";
import { formatExact } from "@/modules/admin/format";
import { DINAMIK_DEALER_DISCOUNTS, dinamikCampaignRate } from "@/modules/suppliers/dinamik-pricing";

/** Body of the Dinamik product page; also opened in a dialog over the list (modal). */
export async function DinamikItemDetail({ id, modal = false }: { id: string; modal?: boolean }) {
  const item = await adminDinamikItem(id);
  if (!item) notFound();
  const p = item.product_data;
  const { sale, pricing } = item;
  const listHref = `/yonetim/tedarikciler/dinamik?brand=${encodeURIComponent(item.list_group)}`;
  const listPrice = item.price_data?.fiyat;
  const cost = item.price_data?.nf;
  const campaign = dinamikCampaignRate(item.price_data?.kampanyaOrani);
  const unit = p.olcuBirimi ? ` ${p.olcuBirimi}` : "";
  const kaporta = item.stock_data?.kaporta?.trim().toUpperCase();
  const stocks = [
    ...dinamikRegions.map(region => ({ label: region.label, available: dinamikRegionStock(item.stock_data, region.key) })),
    { label: "Kaporta", available: kaporta === "VAR" ? true : kaporta === "YOK" ? false : null },
  ];

  return <SupplierProductDetail item={item} modal={modal} supplier="Dinamik" listHref={listHref}
    description={<>{p.stokAdi || "Yalnız fiyat listesinde — ürün bilgisi yok"} · {item.list_group}</>}
    sale={sale} pricing={pricing} cost={typeof cost === "number" ? cost : null}
    productInfo={<Card><CardHeader><CardTitle><h2>Ürün bilgileri</h2></CardTitle><CardDescription>Araç markası ve grup alanları kaynak metinlerdir; doğrulanmış araç uyumluluğu değildir.</CardDescription></CardHeader><CardContent>
        <Fields values={{ Üretici: p.kull3s || p.marka, "Araç markası (kaynak)": p.kull1s, "Ürün grubu": p.kull7s, "Ürün tipi": p.kull8s,
          Barkod: [p.barkod1, p.barkod2, p.barkod3].filter(Boolean).join(", "),
          "Paket miktarı": p.paketMiktari !== undefined ? `${formatExact(p.paketMiktari)}${unit}` : null,
          "Koli miktarı": p.koliMiktari !== undefined ? `${formatExact(p.koliMiktari)}${unit}` : null,
          Desi: typeof p.desi === "number" ? formatExact(p.desi) : null,
        }} numeric={["Paket miktarı", "Koli miktarı", "Desi"]}/>
        <Card size="sm" className="mt-4 py-0"><CardContent><Accordion><AccordionItem value="more">
        <AccordionTrigger>Diğer ürün alanları</AccordionTrigger>
        <AccordionContent><Fields values={{ "İngilizce adı": p.ingilizceAdi, "OEM listesi": p.oemListe, "Eşdeğer listesi": p.esdegerListe, "Görsel adresi": p.resimUrl }}/></AccordionContent>
      </AccordionItem></Accordion></CardContent></Card>
      </CardContent></Card>}
    stockInfo={<Card><CardHeader><CardTitle><h2>Kaynak stokları</h2></CardTitle><CardDescription>Var / Yok, tedarikçinin stok bayrağıdır; adet veya satış teyidi değildir.</CardDescription></CardHeader><CardContent>
      {item.stock_data ? <SupplierStocks stocks={stocks}/> : <Empty><EmptyHeader><EmptyTitle>Stok satırı bulunamadı</EmptyTitle><EmptyDescription>Bu kod yalnız fiyat listesinde. Bölge stokları bilinmiyor.</EmptyDescription></EmptyHeader></Empty>}
    </CardContent></Card>}
    dataInfo={<div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <Fields values={{ "İlk görülme": <Timestamp value={item.first_seen_at}/>, "Son değişim": <Timestamp value={item.changed_at}/>, "Fiyat satırı": formatExact(item.price_count), "Stok satırı": formatExact(item.stock_count) }} numeric={["Fiyat satırı", "Stok satırı"]}/>
        <div className="min-w-0">
          <Fields values={{ "Liste fiyatı": typeof listPrice === "number" ? money(Math.round(listPrice * 100)) : null,
            "Uygulanan iskonto": [...DINAMIK_DEALER_DISCOUNTS.map(pct => `%${pct}`), ...(campaign ? [`%${formatExact(campaign)} kampanya`] : [])].join(" + "),
            "Kampanya alanı": item.price_data?.kampanyaOrani !== undefined ? formatExact(item.price_data.kampanyaOrani) : null,
            "Stok listesi fiyatı": !item.stock_data ? "Stok satırı yok" : typeof item.source_variants.stockListPrice === "number" ? `${money(Math.round(item.source_variants.stockListPrice * 100))} · fiyat listesiyle farklı` : "Fiyat listesiyle aynı",
          }} numeric={["Kampanya alanı"]}/>
          <p className="mt-3 text-xs text-muted-foreground">Maliyet, liste fiyatından iskontolar sırayla düşülerek bulunur (KDV hariç); satış fiyatı bunun üstüne kâr ve KDV ekler. Tüm tarihler İstanbul saatindedir.</p>
        </div>
      </div>}/>;
}
