import { BasbugItemDetail } from "@/components/admin/basbug-item-detail";
import { DinamikItemDetail } from "@/components/admin/dinamik-item-detail";
import { ManualItemDetail } from "@/components/admin/manual-item-detail";
import { SetaItemDetail } from "@/components/admin/seta-item-detail";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { requireAdmin } from "@/modules/auth/session";

export type SupplierKey = "basbug" | "dinamik" | "seta" | "manuel";

export type SupplierItemRouteProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
};

/**
 * One product page body for every supplier: the route files under tedarikciler/<supplier>/urun/[id] render it as a full page,
 * and tedarikciler/<supplier>/@modal/(.)urun/[id] renders the same body (`modal`) in a dialog over the list.
 */
export async function SupplierItemRoute({ supplier, params, searchParams, modal = false }: SupplierItemRouteProps & { supplier: SupplierKey; modal?: boolean }) {
  await requireAdmin();
  const { id } = await params;
  switch (supplier) {
    case "basbug":
      return <BasbugItemDetail id={id} modal={modal}/>;
    case "dinamik":
      return <DinamikItemDetail id={id} modal={modal}/>;
    case "seta":
      return <SetaItemDetail id={id} modal={modal}/>;
    case "manuel":
      return <ManualItemDetail id={id} query={normalizeSearchParams(await searchParams)} modal={modal}/>;
  }
}

// No product dialog: a full page load, or the list itself after a soft navigation (closes an open dialog).
export function NoSupplierItemDialog() {
  return null;
}
