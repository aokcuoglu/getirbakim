import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { feedStateLabels, feedStateTones, type FeedStatus } from "@/modules/suppliers/data-status";

const icons = { success: CircleCheck, warning: TriangleAlert, destructive: CircleAlert, outline: Info } as const;

/** Data freshness of one supplier feed, the same wording as the supplier overview. */
export function FeedStatusBadge({ status }: { status: FeedStatus }) {
  const tone = feedStateTones[status.state];
  const Icon = icons[tone];
  return <Badge variant={tone}><Icon data-icon="inline-start" aria-hidden="true"/>Veriler: {feedStateLabels[status.state].toLocaleLowerCase("tr")}</Badge>;
}
