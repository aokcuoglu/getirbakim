import { BasbugItemDetail } from "@/components/admin/basbug-item-detail";
import { requireAdmin } from "@/modules/auth/session";

export default async function BasbugItemPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  return <BasbugItemDetail id={(await params).id}/>;
}
