import { CircleAlert, CircleCheck, Clock, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import { orderStatus, paymentStatus } from "@/modules/store/orders";
import { Badge } from "@/components/ui/badge";

type Look = { variant: "secondary" | "outline" | "destructive"; icon: LucideIcon };
const success: Look = { variant: "secondary", icon: CircleCheck }, warning: Look = { variant: "outline", icon: TriangleAlert },
  error: Look = { variant: "destructive", icon: CircleAlert }, info: Look = { variant: "outline", icon: Info }, neutral: Look = { variant: "outline", icon: Clock };
const orderLooks: Record<string, Look> = { awaiting_payment: neutral, pending: warning, confirmed: info, shipped: success, cancelled: neutral };
const paymentLooks: Record<string, Look> = { none: neutral, awaiting: neutral, paid: success, expired: neutral, refund_required: error, refunded: info };

function LookBadge({ look, children }: { look: Look; children: React.ReactNode }) {
  return <Badge variant={look.variant}><look.icon data-icon="inline-start" aria-hidden="true"/>{children}</Badge>;
}
export function OrderStatusBadge({ status }: { status: string }) {
  return <LookBadge look={orderLooks[status] ?? neutral}>{orderStatus[status] ?? status}</LookBadge>;
}
export function PaymentStatusBadge({ status }: { status: string }) {
  return <LookBadge look={paymentLooks[status] ?? neutral}>{paymentStatus[status] ?? status}</LookBadge>;
}
