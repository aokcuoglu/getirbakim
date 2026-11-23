export const homeRailSize = 10;
export const homeCollectionSize = 8;

/**
 * Stable reorder that puts the first `perBrand` items of each brand up front (in their original order), then the rest,
 * so one brand (DEPO titles, say) cannot fill a whole home rail. Never drops an item.
 */
export function spreadByBrand<T extends {display_brand: string}>(items: T[], perBrand: number): T[] {
  const seen = new Map<string, number>();
  const first: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    const count = seen.get(item.display_brand) ?? 0;
    seen.set(item.display_brand, count + 1);
    (count < perBrand ? first : rest).push(item);
  }
  return [...first, ...rest];
}
