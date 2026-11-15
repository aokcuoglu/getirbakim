import { CircleCheck, Clock, Truck, type LucideIcon } from "lucide-react";
import { orderStatus, paymentStatus } from "@/modules/store/orders";
import { StatusBadge, type StatusTone } from "@/components/admin/status-badge";

type Look = { tone: StatusTone; icon?: LucideIcon };
const waiting: Look = { tone: "neutral", icon: Clock };
const orderLooks: Record<string, Look> = { awaiting_payment: { tone: "warning" }, pending: { tone: "warning" }, confirmed: { tone: "info" }, shipped: { tone: "info", icon: Truck }, delivered: { tone: "success" }, cancelled: { tone: "error" } };
// A recorded refund is a finished step, not a failure: neutral, with the check icon and its "İade edildi" label.
const paymentLooks: Record<string, Look> = {
  none: waiting, awaiting: { tone: "warning" }, paid: { tone: "success" }, expired: { tone: "error" }, refund_required: { tone: "error" }, refunded: { tone: "neutral", icon: CircleCheck },
};

export function OrderStatusBadge({ status }: { status: string }) {
  const look = orderLooks[status] ?? waiting;
  return <StatusBadge tone={look.tone} icon={look.icon}>{orderStatus[status] ?? status}</StatusBadge>;
}
export function PaymentStatusBadge({ status, prefix }: { status: string; prefix?: boolean }) {
  const look = paymentLooks[status] ?? waiting;
  return <StatusBadge tone={look.tone} icon={look.icon}>{prefix && <span className="sr-only">Ödeme: </span>}{paymentStatus[status] ?? status}</StatusBadge>;
}
