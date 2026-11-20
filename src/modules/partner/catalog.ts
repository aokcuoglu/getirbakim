import "server-only";
import { db } from "@/lib/db";
import { siteUrl } from "@/lib/site";
import { ttlCache } from "@/lib/ttl-cache";
import { catalogRowsByIds, rankedSearchIds, typeFittedIds, withBestOffer, type CatalogProduct } from "@/modules/store/catalog";
import { getCatalogProductImages } from "@/modules/store/product-enrichment";
import { toPartnerProduct, type PartnerCatalogRow, type PartnerFitmentLevel, type PartnerProduct } from "./dto";
import { exactMatches, fitmentLevelOf, fitsFirst } from "./search-order";

export const partnerMinQueryLength = 2;
export const partnerDefaultLimit = 20;
export const partnerMaxLimit = 30;
/**
 * How long an identical request (query, limit, vehicle, discount) is answered from memory (#1093): BakımX searches as
 * the mechanic types and repeats requests. Short and never served stale, because the answer carries prices and
 * availability (informational: an order is quoted again).
 */
export const partnerResponseTtlMs = 30_000;

export function clampPartnerLimit(raw: string | null) {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), partnerMaxLimit) : partnerDefaultLimit;
}

export type PartnerSearch = { q?: string | null; oem?: string | null; partNo?: string | null; limit: number; vehicleTypeId: number | null; discountBps: number };
export type PartnerSearchSource = "part_no" | "oem" | "search";

// Nothing partner-specific goes in: the discount is one setting for every partner, and it is part of the key.
const cachedResponses = ttlCache<PartnerProduct[]>(partnerResponseTtlMs, 500);

/**
 * Partner search over the storefront catalog: the same search engine, ranking, visibility and prices the shop uses, so
 * a partner never sees a product or price the storefront would not sell. Hand-entered store products are left out;
 * partners get supplier-backed parts only. The exact part number / OEM filters and the vehicle order work on the first
 * rankedSearchDepth matches (#1093), so a match ranked below one result page is still found; `limit` is cut last.
 */
export async function searchPartnerProducts(input: PartnerSearch): Promise<{ products: PartnerProduct[]; source: PartnerSearchSource }> {
  const partNo = input.partNo?.trim(), oem = input.oem?.trim(), q = input.q?.trim() ?? "";
  const source: PartnerSearchSource = partNo ? "part_no" : oem ? "oem" : "search";
  const text = (partNo || oem || q).slice(0, 120);
  if (text.length < partnerMinQueryLength) return { products: [], source };
  const key = JSON.stringify([source, text.toLocaleLowerCase("tr"), input.limit, input.vehicleTypeId, input.discountBps]);
  const products = await cachedResponses(key, () => loadPartnerProducts(text, source, { ...input, partNo, oem }));
  return { products, source };
}

async function loadPartnerProducts(text: string, source: PartnerSearchSource, input: PartnerSearch & { partNo?: string; oem?: string }) {
  // The storefront's ranking, without the listing facets the partner never reads (#431), kept per search.
  const ids = await rankedSearchIds(text, source === "search" ? "all" : "code");
  const candidates = exactMatches(await catalogRowsByIds(ids), { partNo: input.partNo, oem: input.oem });
  if (!candidates.length) return [];
  const members = await offerMembers(candidates.map(row => row.id));
  const levels = input.vehicleTypeId == null ? null : await fitmentLevels(members, input.vehicleTypeId);
  return toPartnerProducts(fitsFirst(candidates, levels, input.limit), candidates, members, input, levels);
}

/** Each listed id with the supplier rows grouped under it (product_offers); a row without a group is its own only member. */
async function offerMembers(ids: string[]) {
  const rows = (await db.query<{ primary_id: string; item_id: string }>(
    "SELECT primary_id::text,item_id::text FROM product_offers WHERE primary_id=ANY($1::uuid[])", [ids])).rows;
  const members = new Map(ids.map(id => [id, [id]]));
  for (const row of rows) if (row.item_id !== row.primary_id) members.get(row.primary_id)?.push(row.item_id);
  return members;
}

/**
 * The fitment level of every listed id for one vehicle type: its engine-type links (typeFittedIds, cached, the
 * storefront's fit badge) and the fits of the type's model that the model pages list (storefront_model_fits and
 * storefront_description_fits), read by key for these rows only.
 */
async function fitmentLevels(members: Map<string, string[]>, vehicleTypeId: number) {
  const itemIds = [...members.values()].flat();
  const [typeFitted, modelFitted] = await Promise.all([
    typeFittedIds(vehicleTypeId).then(fitted => new Set(fitted)),
    db.query<{ id: string }>(`WITH model AS (SELECT model_id FROM vehicle_types WHERE id=$1)
      SELECT f.supplier_item_id::text AS id FROM storefront_model_fits f JOIN model ON f.model_id=model.model_id WHERE f.supplier_item_id=ANY($2::uuid[])
      UNION SELECT f.supplier_item_id::text FROM storefront_description_fits f JOIN model ON f.model_id=model.model_id WHERE f.supplier_item_id=ANY($2::uuid[])`,
    [vehicleTypeId, itemIds]).then(result => new Set(result.rows.map(row => row.id))),
  ]);
  return new Map<string, PartnerFitmentLevel>([...members].map(([id, memberIds]) => [id, fitmentLevelOf(memberIds, typeFitted, modelFitted)]));
}

async function toPartnerProducts(rows: CatalogProduct[], candidates: CatalogProduct[], members: Map<string, string[]>, input: PartnerSearch,
  levels: Map<string, PartnerFitmentLevel> | null) {
  if (!rows.length) return [];
  const known = new Map(candidates.map(row => [row.id, row]));
  const missing = [...new Set(rows.flatMap(row => members.get(row.id) ?? []))].filter(id => !known.has(id));
  // Independent lookups run together: the image query alone takes ~2 s (#432).
  const [offerRows, images] = await Promise.all([
    // The grouped supplier offers (db/product-matching.sql) that are not listed rows themselves, priced like the listing.
    catalogRowsByIds(missing),
    getCatalogProductImages(rows),
  ]);
  for (const offer of offerRows) known.set(offer.id, offer);
  return rows.map(listed => {
    const offers = (members.get(listed.id) ?? [listed.id]).flatMap(id => known.get(id) ?? []);
    // The listing row is priced by its best sellable offer, as the storefront card is (withBestOffers).
    const row = withBestOffer(listed, offers);
    const image = images.get(listed.id);
    return toPartnerProduct(row as PartnerCatalogRow, {
      offers: (offers.length ? offers : [row]) as PartnerCatalogRow[], discountBps: input.discountBps, vehicleTypeId: input.vehicleTypeId,
      imageUrl: image ? new URL(image.src, `${siteUrl}/`).toString() : null,
      fitmentLevel: levels?.get(listed.id) ?? null,
    });
  });
}
