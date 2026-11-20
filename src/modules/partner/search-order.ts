import { matchesOem, matchesPartNo, type PartnerCatalogRow, type PartnerFitmentLevel } from "./dto";

const fitmentOrder: Record<PartnerFitmentLevel, number> = { guaranteed: 0, likely: 1, unknown: 2 };

/** Supplier rows of the search that pass the exact part number or OEM filter, in the search's order. */
export function exactMatches<T extends Pick<PartnerCatalogRow, "code" | "display_code" | "oem"> & { source: string }>(
  rows: T[], filter: { partNo?: string; oem?: string },
): T[] {
  const { partNo, oem } = filter;
  return rows.filter(row => row.source === "supplier")
    // A part number matches the supplier code or the store's manufacturer part number (#602).
    .filter(row => partNo ? matchesPartNo(row.code, partNo) || matchesPartNo(row.display_code, partNo) : oem ? matchesOem(row, oem) : true);
}

/**
 * The fitment level of a listed product from the ids linked to the vehicle type and to its model. `memberIds` are the
 * product's own id and its grouped supplier offers' ids (product_offers): a fit of any offer is the product's.
 */
export function fitmentLevelOf(memberIds: string[], typeFitted: ReadonlySet<string>, modelFitted: ReadonlySet<string>): PartnerFitmentLevel {
  if (memberIds.some(id => typeFitted.has(id))) return "guaranteed";
  if (memberIds.some(id => modelFitted.has(id))) return "likely";
  return "unknown";
}

/**
 * The first `limit` rows, those fitting the vehicle first (guaranteed, then likely, then the rest), each group in the
 * search's order. Nothing is filtered out: a part that does not fit is still found, after the fitting ones. Without
 * levels (no vehicle) the search's order is kept.
 */
export function fitsFirst<T extends { id: string }>(rows: T[], levels: ReadonlyMap<string, PartnerFitmentLevel> | null, limit: number): T[] {
  if (!levels) return rows.slice(0, limit);
  const rank = (row: T) => fitmentOrder[levels.get(row.id) ?? "unknown"];
  // Array.prototype.sort is stable: equal levels keep the search's order.
  return [...rows].sort((left, right) => rank(left) - rank(right)).slice(0, limit);
}
