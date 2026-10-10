import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

type Tone = "success" | "error" | "warning" | "info";
const messageStyles: Record<Tone, string> = {
  success: "border-success/25 bg-success/5 text-success *:data-[slot=alert-description]:text-success/90",
  error: "border-destructive/25 bg-destructive/5 text-destructive *:data-[slot=alert-description]:text-destructive/90",
  warning: "border-warning/30 bg-warning/5 text-warning *:data-[slot=alert-description]:text-warning/90",
  info: "border-primary/25 bg-primary/5 text-primary *:data-[slot=alert-description]:text-primary/90",
};
const messageIcons = { success: CircleCheck, error: CircleAlert, warning: TriangleAlert, info: Info };

/** Result of a server action or a page-level warning; errors are announced assertively. */
export function StatusMessage({ tone = "success", title, children }: { tone?: Tone; title?: ReactNode; children: ReactNode }) {
  const Icon = messageIcons[tone];
  return <Alert className={messageStyles[tone]} role={tone === "error" ? "alert" : "status"}>
    <Icon aria-hidden="true"/>
    {title && <div data-slot="alert-title" className="font-medium">{title}</div>}
    <AlertDescription>{children}</AlertDescription>
  </Alert>;
}

const badgeStyles: Record<Tone | "neutral", string> = {
  success: "border-success/20 bg-success/10 text-success",
  warning: "border-warning/25 bg-warning/10 text-warning",
  error: "border-destructive/20 bg-destructive/10 text-destructive",
  info: "border-primary/20 bg-primary/10 text-primary",
  neutral: "border-border bg-muted text-muted-foreground",
};

/** Status text with a colored marker; the text itself carries the meaning. */
export function StatusBadge({ tone = "neutral", className, children }: { tone?: Tone | "neutral"; className?: string; children: ReactNode }) {
  return <Badge variant="outline" className={cn("gap-1.5", badgeStyles[tone], className)}><span className="size-1.5 rounded-full bg-current" aria-hidden="true"/>{children}</Badge>;
}

export function EmptyState({ title, icon, children }: { title: string; icon?: ReactNode; children?: ReactNode }) {
  return <Empty className="py-10">
    <EmptyHeader>
      {icon && <EmptyMedia variant="icon">{icon}</EmptyMedia>}
      <EmptyTitle>{title}</EmptyTitle>
      {children && <EmptyDescription>{children}</EmptyDescription>}
    </EmptyHeader>
  </Empty>;
}

/** Horizontally scrollable, keyboard-focusable region around a data table. */
export function TableRegion({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return <div className={cn("min-w-0 overflow-x-auto focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none", className)} role="region" aria-label={label} tabIndex={0}>{children}</div>;
}
