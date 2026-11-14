import { DinamikItemDetail } from "@/components/admin/dinamik-item-detail";
import { requireAdmin } from "@/modules/auth/session";

export default async function DinamikItemPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  return <DinamikItemDetail id={(await params).id}/>;
}
