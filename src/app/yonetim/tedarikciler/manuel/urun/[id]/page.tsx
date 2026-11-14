import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { ManualItemDetail } from "@/components/admin/manual-item-detail";
import { requireAdmin } from "@/modules/auth/session";

export default async function ManualItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  return <ManualItemDetail id={(await params).id} query={normalizeSearchParams(await searchParams)}/>;
}
