import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type OrderStep = { key: "placed" | "payment" | "confirmation" | "shipping"; label: string; state: "done" | "current" | "upcoming" };

const ended = ["expired", "cancelled", "refund_required", "refunded"];

/** Steps shown above an order; empty when the order ended (cancelled, expired, refund states). */
export function orderSteps(order: { status: string; payment_status: string }): OrderStep[] {
  if (order.status === "cancelled" || ended.includes(order.payment_status)) return [];
  const shipped = order.status === "shipped" || order.status === "delivered";
  const confirmed = shipped || order.status === "confirmed";
  const all: { key: OrderStep["key"]; label: string; done: boolean; skip?: boolean }[] = [
    { key: "placed", label: "Sipariş verildi", done: true },
    { key: "payment", label: "Ödeme", done: order.payment_status === "paid", skip: order.payment_status === "none" },
    { key: "confirmation", label: "Teyit", done: confirmed },
    { key: "shipping", label: "Kargo", done: shipped },
  ];
  const visible = all.filter(step => !step.skip);
  const current = visible.findIndex(step => !step.done);
  return visible.map((step, index) => ({ key: step.key, label: step.label, state: step.done ? "done" : index === current ? "current" : "upcoming" }));
}

export function OrderProgress({ order }: { order: { status: string; payment_status: string } }) {
  const steps = orderSteps(order);
  if (!steps.length) return null;
  return <ol aria-label="Sipariş adımları" className="m-0 mb-5 flex list-none flex-wrap gap-x-2 gap-y-1 p-0 text-sm leading-5">
    {steps.map((step, index) => <li key={step.key} aria-current={step.state === "current" ? "step" : undefined} className={cn("flex items-center gap-2", step.state === "upcoming" ? "text-muted-foreground" : "text-foreground", step.state === "current" && "font-semibold")}>
      {index > 0 && <span aria-hidden className="text-muted-foreground">›</span>}
      <span className={cn("grid size-5 place-items-center rounded-full text-[11px] leading-none font-semibold", step.state === "done" ? "bg-primary text-primary-foreground" : step.state === "current" ? "border-2 border-primary text-primary" : "border border-border text-muted-foreground")} aria-hidden>{step.state === "done" ? <Check className="size-3.5"/> : index + 1}</span>
      <span>{step.label}{step.state === "done" && <span className="sr-only"> tamamlandı</span>}</span>
    </li>)}
  </ol>;
}
