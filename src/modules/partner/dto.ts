import { resolvePartnerPrice, type PartnerPrice, type SupplierPricing } from "./pricing";

/**
 * The partner API's public data contract (#424), field for field the `contractVersion: "1.2"` shape BakımX
 * parses (`src/lib/parts/getirbakim/types.ts` there). Nothing outside these types reaches a partner: supplier
 * cost (`nf`), markup, exchange rate, company, list group, warehouse and stock counts are deliberately absent.
 */
export type PartnerAvailability = "IN_STOCK" | "SUPPLYABLE" | "UNAVAILABLE";
export type PartnerOfferAvailability = "IN_STOCK" | "SUPPLYABLE" | "UNKNOWN";

export type PartnerOffer = {
  /** Opaque, stable offer identity. */
  selectedOfferId: string;
  supplierDisplayName: string;
  /** Informational, non-binding B2B price; kuruş, VAT excluded. */
  informationalPriceKurus: number | null;
  currency: "TRY";
  vatRateBps: number;
  availability: PartnerOfferAvailability;
  /** Supplier stock counts are not shared; availability carries the signal. */
  stockQty: null;
  lastSyncedAt: string | null;
};

export type PartnerProduct = {
  contractVersion: "1.2";
  sourceProductId: string;
  id: string;
  partNo: string;
  manufacturerPartNumber: { value: string; normalized: string };
  name: string;
  brandName: string;
  categoryName: string | null;
  oemNumbers: string[];
  references: { type: "OEM"; value: string; normalized: string; brand: null }[];
  exactFitment: { requestedVehicleTypeId: number | null; status: "CONFIRMED" | "NOT_CONFIRMED" | "NOT_REQUESTED"; matchedVehicleTypeIds: number[] };
  imageUrl: string | null;
  listPriceKurus: number | null;
  b2bPriceKurus: number | null;
  discountBps: number;
  vatRateBps: number;
  currency: "TRY";
  /** Always 0: supplier stock counts are not shared. `availability` is the stock signal. */
  stockQty: 0;
  availability: PartnerAvailability;
  /**
   * When the supplier price/stock was last observed (ISO-8601). Part of the contract: this endpoint does not
   * promise live stock, and the consumer has to show the age.
   */
  lastSyncedAt: string | null;
  offers: PartnerOffer[];
};

/** A supplier row of `commerce_catalog` (the storefront's price and availability view). */
export type PartnerCatalogRow = {
  id: string;
  supplier: string;
  code: string;
  name: string;
  brand: string;
  category: string | null;
  oem: string;
  price_kurus: number | null;
  available: boolean;
  stock_label: string;
  pricing_snapshot: SupplierPricing & { observed_at?: unknown; source_fresh?: unknown };
};

const supplierNames: Record<string, string> = { basbug: "Başbuğ", dinamik: "Dinamik", seta: "SETA", manual: "GetirBakım" };

/** Same rule as BakımX `normalizePartNo`: upper case, letters and digits only. */
export function normalizePartCode(value: string) {
  return value.toLocaleUpperCase("en-US").replace(/[^A-Z0-9]/g, "");
}

/** The supplier's OEM field as separate numbers (suppliers separate them with commas, semicolons or bars). */
export function splitOemNumbers(raw: string) {
  const seen = new Set<string>(), numbers: string[] = [];
  for (const part of raw.split(/[,;|]/)) {
    const value = part.trim(), normalized = normalizePartCode(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    numbers.push(value);
  }
  return numbers.slice(0, 12);
}

/**
 * Sellable now → IN_STOCK; a saved stock that checkout still has to confirm, or goods on their way to the
 * supplier → SUPPLYABLE; anything else, and every row without a current price, is not offered.
 */
export function partnerAvailability(row: PartnerCatalogRow): PartnerAvailability {
  if (row.price_kurus == null) return "UNAVAILABLE";
  if (row.available) return row.pricing_snapshot.source_fresh === false ? "SUPPLYABLE" : "IN_STOCK";
  return row.stock_label === "Tedarikçiye sevkiyat bekleniyor" ? "SUPPLYABLE" : "UNAVAILABLE";
}

function observedAt(row: PartnerCatalogRow) {
  const raw = row.pricing_snapshot.observed_at;
  const date = typeof raw === "string" || raw instanceof Date ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function price(row: PartnerCatalogRow, discountBps: number): PartnerPrice {
  return resolvePartnerPrice(row.pricing_snapshot, row.price_kurus != null, discountBps);
}

export function toPartnerOffer(row: PartnerCatalogRow): PartnerOffer {
  const availability = partnerAvailability(row);
  // Offers carry the undiscounted B2B view, like the old contract: the discount belongs to the product price.
  const offerPrice = price(row, 0);
  return {
    selectedOfferId: `offer_${row.id.replace(/-/g, "")}`,
    supplierDisplayName: supplierNames[row.supplier] ?? "GetirBakım",
    informationalPriceKurus: offerPrice.b2bPriceKurus,
    currency: "TRY",
    vatRateBps: offerPrice.vatRateBps,
    availability: availability === "UNAVAILABLE" ? "UNKNOWN" : availability,
    stockQty: null,
    lastSyncedAt: observedAt(row),
  };
}

/**
 * `row` is the listing row (the best sellable offer's price when several suppliers sell the product), `offers`
 * every grouped offer including the listing row itself. `fitted` lists the ids linked to the requested vehicle.
 */
export function toPartnerProduct(row: PartnerCatalogRow, options: {
  offers: PartnerCatalogRow[]; discountBps: number; imageUrl: string | null; vehicleTypeId: number | null; fitted: boolean;
}): PartnerProduct {
  const productPrice = price(row, options.discountBps);
  const oemNumbers = splitOemNumbers(row.oem);
  const lastSyncedAt = [row, ...options.offers].map(observedAt).filter((value): value is string => value != null).sort().at(-1) ?? null;
  return {
    contractVersion: "1.2",
    sourceProductId: row.id,
    id: row.id,
    partNo: row.code,
    manufacturerPartNumber: { value: row.code, normalized: normalizePartCode(row.code) },
    name: row.name,
    brandName: row.brand,
    categoryName: row.category?.trim() || null,
    oemNumbers,
    references: oemNumbers.map(value => ({ type: "OEM", value, normalized: normalizePartCode(value), brand: null })),
    exactFitment: {
      requestedVehicleTypeId: options.vehicleTypeId,
      status: options.vehicleTypeId == null ? "NOT_REQUESTED" : options.fitted ? "CONFIRMED" : "NOT_CONFIRMED",
      matchedVehicleTypeIds: options.vehicleTypeId != null && options.fitted ? [options.vehicleTypeId] : [],
    },
    imageUrl: options.imageUrl,
    ...productPrice,
    stockQty: 0,
    availability: partnerAvailability(row),
    lastSyncedAt,
    offers: options.offers.map(toPartnerOffer).sort((left, right) => left.supplierDisplayName.localeCompare(right.supplierDisplayName, "tr")),
  };
}

/**
 * Exact manufacturer part number: the supplier code itself, or the code behind a letters-only brand prefix
 * (Başbuğ lists "LUK 510 0207 10" for LuK's "510 0207 10").
 */
export function matchesPartNo(code: string, wanted: string) {
  const normalized = normalizePartCode(code), target = normalizePartCode(wanted);
  if (!target) return false;
  if (normalized === target) return true;
  const prefix = code.trim().match(/^([A-Za-z-]+)\s+/)?.[1];
  return prefix != null && normalized === normalizePartCode(prefix) + target;
}

/** Exact OEM number: one of the row's OEM numbers, or its own code. */
export function matchesOem(row: Pick<PartnerCatalogRow, "code" | "oem">, wanted: string) {
  const target = normalizePartCode(wanted);
  return Boolean(target) && (matchesPartNo(row.code, wanted) || splitOemNumbers(row.oem).some(value => normalizePartCode(value) === target));
}
