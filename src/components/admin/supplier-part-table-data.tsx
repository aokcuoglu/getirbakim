import { AdminAddToCart } from "@/components/admin/admin-add-to-cart";
import type { SupplierPartCell, SupplierPartColumn, SupplierPartTableProps } from "@/components/admin/supplier-part-table";
import type { AdminSupplierItem } from "@/modules/admin/basbug";
import type { DinamikItem } from "@/modules/admin/dinamik";
import type { SetaItem } from "@/modules/admin/seta";
import { money } from "@/modules/store/catalog";
import { basbugStockLabel, basbugWarehouses, basbugWarehouseStock, type BasbugWarehouse } from "@/modules/suppliers/basbug-stock";
import { dinamikRegions, dinamikRegionStock, type DinamikRegionKey } from "@/modules/suppliers/dinamik-stock";

const number = (value: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(value);
const price = (value: number | null | undefined) => value == null ? null : new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const presenceLabel = (presence: string) => presence === "present" ? "Güncel listede var" : presence === "inactive" ? "Pasif" : "Listede yok";
const text = (value: SupplierPartCell["value"], title?: string): SupplierPartCell => ({ value, title: title ?? (value == null ? undefined : String(value)) });
const stockCell = (available: boolean | null, title: string): SupplierPartCell => ({
  value: available === null ? "Veri yok" : available ? "Var" : "Yok",
  variant: available === null ? "warning" : available ? "success" : "outline",
  title,
});

function checkCell(item: { presence: string; conflicting: boolean }, missingPrice: boolean, repeated: boolean, priceOnly = false): SupplierPartCell {
  if (item.presence !== "present") return { value: item.presence === "inactive" ? "Pasif" : "Listede yok", variant: "warning" };
  if (item.conflicting) return { value: "Çelişkili", variant: "destructive" };
  if (missingPrice) return { value: "Fiyat eksik", variant: "warning" };
  if (priceOnly) return { value: "Yalnız fiyat", variant: "outline" };
  if (repeated) return { value: "Tekrar var", variant: "info" };
  return { value: null };
}

const saleColumn: SupplierPartColumn = { key: "sale", label: "Satış (₺)", align: "right", numeric: true, emphasized: true };
const nameColumn: SupplierPartColumn = { key: "name", label: "Ürün adı", width: "wide", emphasized: true, sortKey: "name" };
const costColumn: SupplierPartColumn = { key: "cost", label: "NF", title: "KDV hariç maliyet", align: "right", numeric: true, missingLabel: "Eksik", sortKey: "cost" };
const options = (values: string[]) => values.map(value => ({ value, label: value }));
// The "Kontrol" header filters by the list's ?quality= values.
const checkColumn = (qualities: [string, string][]): SupplierPartColumn => ({ key: "check", label: "Kontrol", width: "medium",
  filter: { param: "quality", options: qualities.map(([value, label]) => ({ value, label })) } });
const stockOptions = [{ value: "1", label: "Stok var" }, { value: "0", label: "Stok yok" }];

export function basbugPartTableProps(items: AdminSupplierItem[], warehouse: BasbugWarehouse, lists: { brands: string[]; currencies: string[] } = { brands: [], currencies: [] }): SupplierPartTableProps {
  return {
    caption: "Başbuğ ürünleri, fiyatları ve depo bazlı stok durumları",
    columns: [
      { key: "oem", label: "OEM" }, nameColumn,
      { key: "brand", label: "Marka", sortKey: "brand", filter: { param: "brand", options: options(lists.brands) } },
      { key: "currency", label: "PB", title: "Kaynak para birimi", filter: { param: "currency", options: options(lists.currencies) } },
      costColumn, saleColumn,
      ...basbugWarehouses.map(depot => ({ key: depot, label: depot === warehouse ? <strong>{depot}</strong> : depot, align: "center" as const, title: `${depot} depo stok durumu` })),
      checkColumn([["missing-price", "Fiyatı eksik"], ["duplicates", "Tekrarlanan kod"], ["conflicts", "Çelişkili kayıt"]]),
    ],
    rows: items.map(item => {
      const p = item.product_data;
      const stocks = basbugWarehouses.map(depot => {
        const stock = basbugWarehouseStock(item.stock_data, depot);
        return { label: depot, available: stock === null ? null : stock > 0 };
      });
      const repeated = item.product_count > 1 || item.price_count > 1 || item.stock_count > 1;
      return {
        id: item.id, code: item.code, detailHref: `/yonetim/tedarikciler/basbug/urun/${item.id}`,
        cells: {
          oem: text(p.oe), name: text(p.ac, [p.ac, p.ac2].filter(Boolean).join(" · ")), brand: text(p.uk), currency: text(p.dc),
          cost: text(item.price_data ? number(item.price_data.nf) : null, item.price_data ? number(item.price_data.nf) : "Fiyat eksik"),
          sale: text(item.sale_price_kurus ? money(item.sale_price_kurus) : null, item.sale_price_kurus ? money(item.sale_price_kurus) : "Satış fiyatı yok"),
          ...Object.fromEntries(basbugWarehouses.map(depot => {
            const stock = basbugWarehouseStock(item.stock_data, depot);
            return [depot, stockCell(stock === null ? null : stock > 0, stock === null ? `${depot}: Stok verisi alınamadı veya bu depoya erişim yok` : `${depot}: ${basbugStockLabel(stock)}`)];
          })),
          check: checkCell(item, !item.price_data, repeated),
        },
        details: {
          title: p.ac || "Ürün bilgisi yok", supplier: "Başbuğ",
          fields: [
            ["Marka", p.uk], ["OEM", p.oe], ["Ek açıklama", p.ac2], ["Model", p.m],
            ["Motor", p.mo], ["Yıl", p.y], ["Birim", p.b], ["Liste grubu", p.lgk],
            ["NF · KDV hariç maliyet", item.price_data ? `${number(item.price_data.nf)} ${p.dc}` : "Fiyat eksik"],
            ["Satış fiyatı · KDV dahil", item.sale_price_kurus ? money(item.sale_price_kurus) : "Satışa kapalı"],
            ["Satış durumu", item.sale_stock_label || "Satışa kapalı"], ["Listede bulunma", presenceLabel(item.presence)],
            ["Veri kontrolü", item.conflicting ? "Çelişkili kayıt" : !item.price_data ? "Fiyat eksik" : repeated ? "Tekrarlanan kod" : "—"],
            ["Kaynak satırları", `${item.product_count} ürün · ${item.price_count} fiyat · ${item.stock_count} stok`],
          ],
          stockTitle: "Depo stokları", stocks,
          footer: <AdminAddToCart productId={item.id} name={p.ac} available={Boolean(item.sale_available && item.sale_price_kurus)}/>,
        },
      };
    }),
  };
}

export function setaPartTableProps(items: SetaItem[]): SupplierPartTableProps {
  return {
    caption: "SETA ürünleri, fiyatları ve stok durumları",
    columns: [
      { key: "oem", label: "OEM" }, nameColumn,
      { key: "vehicle", label: "Araç" }, { key: "cross", label: "Çapraz referans", width: "medium" },
      { key: "currency", label: "PB", title: "Kaynak para birimi" },
      { ...costColumn, title: "KDV hariç bayi fiyatı" }, saleColumn,
      { key: "stock", label: "Stok", align: "center", filter: { param: "stock", options: stockOptions } },
      checkColumn([["missing-price", "Fiyatı eksik"], ["conflicts", "Çelişkili kayıt"]]),
    ],
    rows: items.map(item => {
      const p = item.product_data;
      const stock = item.stock_data?.stok ?? null;
      const cross = Object.entries(p.cross ?? {}).map(([brand, code]) => `${brand || "?"} ${code}`).join(" · ");
      return {
        id: item.id, code: item.code, detailHref: `/yonetim/tedarikciler/seta/urun/${item.id}`,
        cells: {
          oem: text(p.oe), name: text(p.ac, [p.ac, p.ac2].filter(Boolean).join(" · ")),
          vehicle: text(p.vehicle_brand, [p.vehicle_brand, p.ac2].filter(Boolean).join(" · ")), cross: text(cross), currency: text(p.dc),
          cost: text(item.price_data ? number(item.price_data.nf) : null, item.price_data ? number(item.price_data.nf) : "Fiyat eksik"),
          sale: text(item.sale_price_kurus ? money(item.sale_price_kurus) : null, item.sale_price_kurus ? `${money(item.sale_price_kurus)} · ${item.sale_stock_label || ""}` : "Satışa kapalı"),
          stock: stockCell(stock === null ? null : stock > 0, "Kaynak adet değil, var/yok bildirir"),
          check: checkCell(item, !item.price_data, item.product_count > 1),
        },
      };
    }),
  };
}

export function dinamikPartTableProps(items: DinamikItem[], region: DinamikRegionKey | "any", hasProducts: boolean, lists: { brands: string[]; groups: string[] } = { brands: [], groups: [] }): SupplierPartTableProps {
  return {
    caption: "Dinamik ürünleri, liste fiyatları ve bölge stok durumları",
    codeLabel: "Stok kodu",
    emptyDescription: hasProducts ? "Aramayı veya filtreleri değiştirebilirsiniz." : "Henüz Dinamik verisi çekilmedi; zamanlayıcı markaları sırayla çeker.",
    columns: [
      nameColumn, { key: "brand", label: "Marka", sortKey: "brand", filter: { param: "brand", options: options(lists.brands) } }, { key: "vehicle", label: "Araç" },
      { key: "group", label: "Grup", width: "medium", filter: lists.groups.length <= 200 ? { param: "group", options: options(lists.groups) } : { param: "group", placeholder: "Grup adı" } },
      { ...costColumn, label: "Fiyat (₺)", title: "KDV hariç maliyet (₺)" },
      { ...saleColumn, title: "Mağaza satış fiyatı, KDV dahil" },
      { key: "campaign", label: "Kamp.", title: "Kampanya oranı", align: "right", numeric: true },
      ...dinamikRegions.map(r => ({ key: r.key, label: r.key === region ? <strong>{r.short}</strong> : r.short, align: "center" as const, title: `${r.label} stok durumu (${r.key})` })),
      checkColumn([["missing-price", "Fiyatı eksik"], ["price-only", "Yalnız fiyat"], ["campaign", "Kampanyalı"], ["duplicates", "Tekrarlanan kod"], ["conflicts", "Çelişkili kayıt"]]),
    ],
    rows: items.map(item => {
      const p = item.product_data;
      const campaign = Number(item.price_data?.kampanyaOrani ?? 0);
      const campaignLabel = campaign ? `%${new Intl.NumberFormat("tr-TR").format(campaign > 1 ? campaign : campaign * 100)}` : "—";
      const repeated = item.price_count > 1 || item.stock_count > 1;
      return {
        id: item.id, code: item.code, detailHref: `/yonetim/tedarikciler/dinamik/urun/${item.id}`,
        cells: {
          name: text(p.stokAdi || "Ürün bilgisi yok", p.stokAdi ?? "Yalnız fiyat listesinde; ürün bilgisi yok"),
          brand: text(item.list_group), vehicle: text(p.kull1s), group: text(p.kull8s || p.kull7s, [p.kull7s, p.kull8s].filter(Boolean).join(" · ")),
          cost: text(price(item.price_data?.fiyat)), sale: text(item.sale_price_kurus ? money(item.sale_price_kurus) : null, item.sale_stock_label ?? "Satışa kapalı"),
          campaign: text(campaignLabel),
          ...Object.fromEntries(dinamikRegions.map(r => {
            const stock = dinamikRegionStock(item.stock_data, r.key);
            return [r.key, stockCell(stock, stock === null ? `${r.label}: stok verisi yok` : `${r.label}: ${stock ? "VAR" : "YOK"}`)];
          })),
          check: checkCell(item, item.price_data?.fiyat == null, repeated, !item.stock_data),
        },
        details: {
          title: p.stokAdi || "Ürün bilgisi yok", supplier: "Dinamik",
          fields: [
            ["Marka", item.list_group], ["İngilizce adı", p.ingilizceAdi], ["Araç", p.kull1s], ["Üretici", p.kull3s],
            ["Ürün grubu", p.kull7s], ["Ürün tipi", p.kull8s], ["OEM listesi", p.oemListe], ["Eşdeğer listesi", p.esdegerListe],
            ["Barkod", [p.barkod1, p.barkod2, p.barkod3].filter(Boolean).join(" · ")],
            ["Paket / koli", p.paketMiktari !== undefined ? `${p.paketMiktari} / ${p.koliMiktari ?? "—"} ${p.olcuBirimi ?? ""}` : null],
            ["Maliyet · KDV hariç (₺)", price(item.price_data?.fiyat) ?? "Fiyat eksik"],
            ["Satış fiyatı · KDV dahil", item.sale_price_kurus ? money(item.sale_price_kurus) : item.stock_data ? "Satışa kapalı" : "Mağazada gösterilmiyor"],
            ["Kampanya oranı", campaignLabel], ["Listede bulunma", presenceLabel(item.presence)],
            ["Veri kontrolü", item.conflicting ? "Çelişkili kayıt" : item.price_data?.fiyat == null ? "Fiyat eksik" : !item.stock_data ? "Yalnız fiyat kaydı; stok listesinde yok" : repeated ? "Tekrarlanan kod" : "—"],
            ["Kaynak satırları", `${item.price_count} fiyat · ${item.stock_count} stok`],
          ],
          stockTitle: "Bölge stokları", stocks: dinamikRegions.map(r => ({ label: r.label, available: dinamikRegionStock(item.stock_data, r.key) })),
          footer: <p className="text-muted-foreground">Liste fiyatı KDV hariç maliyet kabul edilir; satış fiyatı ortak kâr + KDV ile hesaplanır, kampanya oranı uygulanmaz. Stoklar adet yerine var/yok bildirir.</p>,
        },
      };
    }),
  };
}
