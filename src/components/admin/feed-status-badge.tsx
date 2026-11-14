import { StatusBadge } from "@/components/admin/status-badge";
import { feedStateLabels, feedStateTones, type FeedStatus } from "@/modules/suppliers/data-status";

/** Data freshness of one supplier feed, the same wording as the supplier overview; "Okunamadı" when it could not be read. */
export function FeedStatusBadge({ status }: { status: FeedStatus | null | undefined }) {
  if (!status) return <StatusBadge tone="error">Okunamadı</StatusBadge>;
  return <StatusBadge tone={feedStateTones[status.state]}>
    Veriler: {feedStateLabels[status.state].toLocaleLowerCase("tr")}
  </StatusBadge>;
}
