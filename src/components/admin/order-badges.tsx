import { CircleAlert, CircleCheck, Clock, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import { orderStatus, paymentStatus } from "@/modules/store/orders";
import { Badge } from "@/components/ui/badge";

type Look = { variant: "success" | "warning" | "destructive" | "info" | "outline"; icon: LucideIcon };
const success: Look = { variant: "success", icon: CircleCheck }, warning: Look = { variant: "warning", icon: TriangleAlert },
  error: Look = { variant: "destructive", icon: CircleAlert }, info: Look = { variant: "info", icon: Info }, neutral: Look = { variant: "outline", icon: Clock };
const orderLooks: Record<string, Look> = { awaiting_payment: warning, pending: warning, confirmed: info, shipped: success, cancelled: error };
const paymentLooks: Record<string, Look> = { none: neutral, awaiting: warning, paid: success, expired: error, refund_required: error, refunded: error };

function LookBadge({ look, children }: { look: Look; children: React.ReactNode }) {
  return <Badge variant={look.variant}><look.icon data-icon="inline-start" aria-hidden="true"/>{children}</Badge>;
}
export function OrderStatusBadge({ status }: { status: string }) {
  return <LookBadge look={orderLooks[status] ?? neutral}>{orderStatus[status] ?? status}</LookBadge>;
}
export function PaymentStatusBadge({ status }: { status: string }) {
  return <LookBadge look={paymentLooks[status] ?? neutral}>{paymentStatus[status] ?? status}</LookBadge>;
}
