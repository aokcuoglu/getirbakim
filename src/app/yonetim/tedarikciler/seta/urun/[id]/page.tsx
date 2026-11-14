import { SetaItemDetail } from "@/components/admin/seta-item-detail";
import { requireAdmin } from "@/modules/auth/session";

export default async function SetaItemPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  return <SetaItemDetail id={(await params).id}/>;
}
