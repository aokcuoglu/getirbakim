import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { ManualItemDetail } from "@/components/admin/manual-item-detail";
import { requireAdmin } from "@/modules/auth/session";

// The product page's body in a dialog over the list; urun/[id]/page.tsx renders the same body as a full page.
export default async function ManualItemDialog({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  return <ManualItemDetail id={(await params).id} query={normalizeSearchParams(await searchParams)} modal/>;
}
