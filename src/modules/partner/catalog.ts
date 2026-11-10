import "server-only";
import { db } from "@/lib/db";
import { siteUrl } from "@/lib/site";
import { browseProducts, catalogSql, typeFittedIds } from "@/modules/store/catalog";
import { getCatalogProductImages } from "@/modules/store/product-enrichment";
import { storefrontCompanies } from "@/modules/suppliers/storefront-sources";
import { matchesOem, matchesPartNo, toPartnerProduct, type PartnerCatalogRow, type PartnerProduct } from "./dto";

export const partnerMinQueryLength = 2;
export const partnerDefaultLimit = 20;
/** One storefront result page: the search engine ranks and returns this many per query. */
export const partnerMaxLimit = 30;

export function clampPartnerLimit(raw: string | null) {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), partnerMaxLimit) : partnerDefaultLimit;
}

export type PartnerSearch = { q?: string | null; oem?: string | null; partNo?: string | null; limit: number; vehicleTypeId: number | null; discountBps: number };
export type PartnerSearchSource = "part_no" | "oem" | "search";

/**
 * Partner search over the storefront catalog: the same search engine, visibility and prices the shop uses
 * (`browseProducts`), so a partner never sees a product or price the storefront would not sell. Hand-entered
 * store products are left out; partners get supplier-backed parts only.
 */
export async function searchPartnerProducts(input: PartnerSearch): Promise<{ products: PartnerProduct[]; source: PartnerSearchSource }> {
  const partNo = input.partNo?.trim(), oem = input.oem?.trim(), q = input.q?.trim() ?? "";
  const source: PartnerSearchSource = partNo ? "part_no" : oem ? "oem" : "search";
  const text = (partNo || oem || q).slice(0, 120);
  if (text.length < partnerMinQueryLength) return { products: [], source };
  const { items } = await browseProducts({ q: text, searchBy: source === "search" ? "all" : "code" });
  const rows = (items as (PartnerCatalogRow & { source: string })[]).filter(item => item.source === "supplier")
    .filter(item => partNo ? matchesPartNo(item.code, partNo) : oem ? matchesOem(item, oem) : true)
    .slice(0, input.limit);
  return { products: await toPartnerProducts(rows, input), source };
}

async function toPartnerProducts(rows: PartnerCatalogRow[], input: PartnerSearch) {
  if (!rows.length) return [];
  const ids = rows.map(row => row.id);
  // Every supplier offer grouped under a listed product (db/product-matching.sql), priced like the listing.
  const grouped = (await db.query<PartnerCatalogRow & { primary_id: string }>(`SELECT o.primary_id::text,priced.* FROM product_offers o
   JOIN LATERAL (SELECT * FROM (${catalogSql}) priced WHERE priced.id=o.item_id OFFSET 0) priced ON true
   WHERE o.primary_id=ANY($2::uuid[])`, [storefrontCompanies(), ids])).rows;
  const offersOf = (row: PartnerCatalogRow) => {
    const group = grouped.filter(offer => offer.primary_id === row.id);
    return group.length ? group : [row];
  };
  const images = await getCatalogProductImages(rows);
  const fitted = input.vehicleTypeId == null ? new Set<string>() : new Set(await typeFittedIds(input.vehicleTypeId));
  return rows.map(row => {
    const offers = offersOf(row);
    const image = images.get(row.id);
    return toPartnerProduct(row, {
      offers, discountBps: input.discountBps, vehicleTypeId: input.vehicleTypeId,
      imageUrl: image ? new URL(image.src, `${siteUrl}/`).toString() : null,
      fitted: [row, ...offers].some(offer => fitted.has(offer.id)),
    });
  });
}
