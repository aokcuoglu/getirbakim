import type { SupplierPartCell, SupplierPartColumn, SupplierPartTableProps } from "@/components/admin/supplier-part-table";
import type { AdminSupplierItem } from "@/modules/admin/basbug";
import type { DinamikItem } from "@/modules/admin/dinamik";
import type { SetaItem } from "@/modules/admin/seta";
import type { ManualItem } from "@/modules/admin/manual";
import { money } from "@/modules/store/catalog";
import { formatDecimal, formatNumber } from "@/modules/admin/format";
import { basbugStockLabel, basbugWarehouses, basbugWarehouseStock, type BasbugWarehouse } from "@/modules/suppliers/basbug-stock";
import { dinamikRegions, dinamikRegionStock, type DinamikRegionKey } from "@/modules/suppliers/dinamik-stock";
import { dinamikCampaignRate } from "@/modules/suppliers/dinamik-pricing";

const number = formatNumber;
const price = (value: number | null | undefined) => value == null ? null : formatDecimal(value);
const text = (value: SupplierPartCell["value"], title?: string): SupplierPartCell => ({ value, title: title ?? (value == null ? undefined : String(value)) });
const stockCell = (available: boolean | null, title: string): SupplierPartCell => ({
  value: available === null ? "Veri yok" : available ? "Var" : "Yok",
  tone: available === null ? "warning" : available ? "success" : "neutral",
  title,
});

function checkCell(item: { presence: string; conflicting: boolean }, missingPrice: boolean, repeated: boolean, priceOnly = false): SupplierPartCell {
  if (item.presence !== "present") return { value: item.presence === "inactive" ? "Pasif" : "Listede yok", tone: "warning" };
  if (item.conflicting) return { value: "Çelişkili", tone: "error" };
  if (missingPrice) return { value: "Fiyat eksik", tone: "warning" };
  if (priceOnly) return { value: "Yalnız fiyat", tone: "neutral" };
  if (repeated) return { value: "Tekrar var", tone: "info" };
  return { value: null };
}

const saleColumn: SupplierPartColumn = { key: "sale", label: "Satış (₺)", align: "right", numeric: true, emphasized: true };
const nameColumn: SupplierPartColumn = { key: "name", label: "Ürün adı", width: "wide", emphasized: true, sortKey: "name" };
// One cost header on every supplier table; each page's note line says what the supplier's cost is (costNotes).
const costColumn: SupplierPartColumn = { key: "cost", label: "Maliyet (KDV hariç)", title: "KDV hariç maliyet", align: "right", numeric: true, missingLabel: "Eksik", sortKey: "cost" };
/** Note line above each supplier table: what "Maliyet" is for that supplier; "Satış" is always the store price with VAT. */
export const costNotes = {
  basbug: "Maliyet: Başbuğ NF fiyatı, kaynak para biriminde · Satış: kâr + KDV dahil",
  dinamik: "Maliyet: Dinamik liste fiyatı − %45 − %5 − kampanya (₺) · Satış: kâr + KDV dahil · Stok: var/yok",
  seta: "Maliyet: SETA bayi fiyatı · Satış: kâr + KDV dahil · Stok: var/yok",
  manual: "Maliyet: dosyadaki alış fiyatı · Satış: kâr + KDV dahil",
} as const;
// The "Kontrol" header filters by the list's ?quality= values.
const checkColumn = (qualities: [string, string][]): SupplierPartColumn => ({ key: "check", label: "Kontrol", width: "medium",
  filter: { param: "quality", options: qualities.map(([value, label]) => ({ value, label })) } });
const stockOptions = [{ value: "1", label: "Stok var" }, { value: "0", label: "Stok yok" }];

export function basbugPartTableProps(items: AdminSupplierItem[], warehouse: BasbugWarehouse, lists: { brands: string[]; currencies: string[] } = { brands: [], currencies: [] }): SupplierPartTableProps {
  return {
    caption: "Başbuğ ürünleri, fiyatları ve depo bazlı stok durumları",
    columns: [
      { key: "oem", label: "OEM" }, nameColumn,
      { key: "brand", label: "Marka", sortKey: "brand", filter: { param: "brand", values: lists.brands } },
      { key: "currency", label: "PB", title: "Kaynak para birimi", filter: { param: "currency", values: lists.currencies } },
      costColumn, saleColumn,
      ...basbugWarehouses.map(depot => ({ key: depot, label: depot === warehouse ? <strong>{depot}</strong> : depot, align: "center" as const, title: `${depot} depo stok durumu` })),
      checkColumn([["missing-price", "Fiyatı eksik"], ["duplicates", "Tekrarlanan kod"], ["conflicts", "Çelişkili kayıt"]]),
    ],
    rows: items.map(item => {
      const p = item.product_data;
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
      checkColumn([["missing-price", "Fiyatı eksik"], ["duplicates", "Tekrarlanan kod"], ["conflicts", "Çelişkili kayıt"]]),
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
    emptyDescription: hasProducts ? undefined : "Henüz Dinamik verisi çekilmedi; zamanlayıcı markaları sırayla çeker.",
    columns: [
      nameColumn, { key: "brand", label: "Marka", sortKey: "brand", filter: { param: "brand", values: lists.brands } }, { key: "vehicle", label: "Araç" },
      { key: "group", label: "Grup", width: "medium", filter: lists.groups.length <= 200 ? { param: "group", values: lists.groups } : { param: "group", placeholder: "Grup adı" } },
      { ...costColumn, title: "KDV hariç maliyet (₺)" },
      { ...saleColumn, title: "Mağaza satış fiyatı, KDV dahil" },
      { key: "campaign", label: "Kamp.", title: "Kampanya oranı", align: "right", numeric: true },
      ...dinamikRegions.map(r => ({ key: r.key, label: r.key === region ? <strong>{r.short}</strong> : r.short, align: "center" as const, title: `${r.label} stok durumu (${r.key})` })),
      checkColumn([["missing-price", "Fiyatı eksik"], ["price-only", "Yalnız fiyat"], ["campaign", "Kampanyalı"], ["duplicates", "Tekrarlanan kod"], ["conflicts", "Çelişkili kayıt"]]),
    ],
    rows: items.map(item => {
      const p = item.product_data;
      const campaign = dinamikCampaignRate(item.price_data?.kampanyaOrani);
      const campaignLabel = campaign ? `%${new Intl.NumberFormat("tr-TR").format(campaign)}` : "—";
      const repeated = item.price_count > 1 || item.stock_count > 1;
      return {
        id: item.id, code: item.code, detailHref: `/yonetim/tedarikciler/dinamik/urun/${item.id}`,
        cells: {
          name: text(p.stokAdi || "Ürün bilgisi yok", p.stokAdi ?? "Yalnız fiyat listesinde; ürün bilgisi yok"),
          brand: text(item.list_group), vehicle: text(p.kull1s), group: text(p.kull8s || p.kull7s, [p.kull7s, p.kull8s].filter(Boolean).join(" · ")),
          cost: text(price(item.price_data?.nf), item.price_data?.fiyat == null ? undefined : `Liste fiyatı ${price(item.price_data.fiyat)}`), sale: text(item.sale_price_kurus ? money(item.sale_price_kurus) : null, item.sale_stock_label ?? "Satışa kapalı"),
          campaign: text(campaignLabel),
          ...Object.fromEntries(dinamikRegions.map(r => {
            const stock = dinamikRegionStock(item.stock_data, r.key);
            return [r.key, stockCell(stock, stock === null ? `${r.label}: stok verisi yok` : `${r.label}: ${stock ? "VAR" : "YOK"}`)];
          })),
          check: checkCell(item, item.price_data?.fiyat == null, repeated, !item.stock_data),
        },
      };
    }),
  };
}

export function manualPartTableProps(items: ManualItem[], lists: { categories: string[] }): SupplierPartTableProps {
  return {
    caption: "Manuel listedeki ürünler, fiyatları ve stokları",
    columns: [
      nameColumn, { key: "brand", label: "Marka", sortKey: "brand" },
      { key: "category", label: "Kategori", width: "medium", filter: { param: "category", values: lists.categories } },
      { key: "package", label: "Ambalaj", missingLabel: "Eksik" }, { key: "viscosity", label: "Viskozite" },
      { ...costColumn, title: "KDV hariç alış fiyatı" }, saleColumn,
      { key: "stock", label: "Stok", align: "right", numeric: true, filter: { param: "stock", options: [...stockOptions, { value: "none", label: "Stok bilgisi yok" }] } },
      { key: "image", label: "Resim", align: "center" },
      checkColumn([["missing-price", "Fiyatı eksik"], ["missing-package", "Ambalajı eksik"], ["missing-image", "Resmi yok"]]),
    ],
    rows: items.map(item => {
      const p = item.product_data;
      const stock = item.stock_data?.stok ?? null;
      return {
        id: item.id, code: item.code, detailHref: `/yonetim/tedarikciler/manuel/urun/${item.id}`,
        cells: {
          name: text(p.ac), brand: text(p.uk), category: text(p.category_name), package: text(p.package, p.package ?? "Ambalaj eksik"),
          viscosity: text(p.viscosity),
          cost: text(item.price_data ? number(item.price_data.nf) : null, item.price_data ? number(item.price_data.nf) : "Fiyat eksik"),
          sale: text(item.sale_price_kurus ? money(item.sale_price_kurus) : null, item.sale_price_kurus ? `${money(item.sale_price_kurus)} · ${item.sale_stock_label || ""}` : "Satışa kapalı"),
          stock: stock === null ? { value: "Veri yok", tone: "warning", title: "Stok girilmemiş" } : text(number(stock)),
          image: item.has_image ? { value: "Var", tone: "success" } : { value: "Yok", tone: "neutral" },
          check: item.presence !== "present" ? checkCell(item, false, false) : !item.price_data ? { value: "Fiyat eksik", tone: "warning" }
            : !p.package ? { value: "Ambalaj eksik", tone: "warning" } : item.overridden ? { value: "Panelden tamamlandı", tone: "info" } : { value: null },
        },
      };
    }),
  };
}
