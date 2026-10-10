import { orderStatus, paymentStatus } from "@/modules/store/orders";
import { StatusBadge } from "@/components/admin/ui";

const orderTones: Record<string, "success" | "warning" | "error" | "info" | "neutral"> = {
  awaiting_payment: "neutral", pending: "warning", confirmed: "info", shipped: "success", cancelled: "neutral",
};
const paymentTones: Record<string, "success" | "warning" | "error" | "info" | "neutral"> = {
  none: "neutral", awaiting: "neutral", paid: "success", expired: "neutral", refund_required: "error", refunded: "info",
};

export function OrderStatusBadge({ status }: { status: string }) {
  return <StatusBadge tone={orderTones[status] ?? "neutral"}>{orderStatus[status] ?? status}</StatusBadge>;
}
export function PaymentStatusBadge({ status }: { status: string }) {
  return <StatusBadge tone={paymentTones[status] ?? "neutral"}>{paymentStatus[status] ?? status}</StatusBadge>;
}
