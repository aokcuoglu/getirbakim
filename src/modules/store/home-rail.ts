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

/** A tile under the home category tabs: the four fields the tile renders. */
export type HomeTabCategory = {id: number; name: string; slug: string; imagePath?: string | null};
type CategoryNode = {id: number; parentId: number | null; name: string; slug: string; imagePath?: string | null};

/** The children of `parentId` in the order given (the store order), as tab tiles. */
export function childCategories(categories: CategoryNode[], parentId: number | undefined): HomeTabCategory[] {
  return categories.filter(category => category.parentId === parentId).map(({id, name, slug, imagePath}) => ({id, name, slug, imagePath}));
}

/**
 * The home category tabs (#1295): every root as a tab, but only the first root's tiles in the page; the other tabs
 * read theirs from /api/categories (useCategoryTree) when the tab list is approached.
 */
export function homeCategoryTabs(categories: CategoryNode[]): {roots: {id: number; name: string}[]; initial: HomeTabCategory[]} {
  const roots = categories.filter(category => category.parentId === null).map(({id, name}) => ({id, name}));
  return {roots, initial: childCategories(categories, roots[0]?.id)};
}
