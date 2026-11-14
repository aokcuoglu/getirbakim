import type { ComponentProps, ReactNode } from "react";
import { CircleAlert, CircleCheck, CircleMinus, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { runStatusLabel, runStatusTone, type StatusTone } from "@/modules/suppliers/run-status";

export type { StatusTone };

/**
 * The admin's one tone → Badge variant + icon table (AGENTS.md colour language). Neutral is plain absence or a
 * finished/idle state ("Yok", "Stok yok", "Kapalı"); destructive stays for failures.
 */
const looks: Record<StatusTone, { variant: "success" | "warning" | "destructive" | "info" | "outline"; icon: LucideIcon }> = {
  success: { variant: "success", icon: CircleCheck },
  warning: { variant: "warning", icon: TriangleAlert },
  error: { variant: "destructive", icon: CircleAlert },
  info: { variant: "info", icon: Info },
  neutral: { variant: "outline", icon: CircleMinus },
};

/**
 * A status in the admin's colour language: tone picks the Badge variant and icon, the text carries the meaning.
 * `icon` swaps in a more specific icon (Clock for waiting, TrendingUp for growth); `render` turns the badge into a link.
 */
export function StatusBadge({ tone, icon, children, ...props }: {
  tone: StatusTone; icon?: LucideIcon; children: ReactNode;
} & Pick<ComponentProps<typeof Badge>, "className" | "title" | "render">) {
  const look = looks[tone];
  const Icon = icon ?? look.icon;
  return <Badge variant={look.variant} {...props}><Icon data-icon="inline-start" aria-hidden="true"/>{children}</Badge>;
}

/** Status of one supplier run (supplier_imports.status). */
export function RunStatusBadge({ status }: { status: string }) {
  return <StatusBadge tone={runStatusTone(status)}>{runStatusLabel(status)}</StatusBadge>;
}

