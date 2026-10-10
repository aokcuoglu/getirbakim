import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

const toneDot = { success: "bg-success", warning: "bg-warning", danger: "bg-destructive", neutral: "bg-muted-foreground/50" };

export function StatGrid({ label, children }: { label: string; children: ReactNode }) {
  return <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label={label}>{children}</dl>;
}

/** KPI card. `tone` adds a status dot next to the label; the note or value text carries the meaning. */
export function Stat({ label, value, note, href, linkLabel = "İncele", icon: Icon, tone }: {
  label: string; value: ReactNode; note?: ReactNode; href?: string; linkLabel?: string; icon?: LucideIcon;
  tone?: "success" | "warning" | "danger" | "neutral";
}) {
  return <Card className="gap-2 px-4 py-4">
    <dt className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
      {Icon && <Icon className="size-4" aria-hidden="true"/>}{label}
      {tone && <span className={cn("ml-auto size-2 rounded-full", toneDot[tone])} aria-hidden="true"/>}
    </dt>
    <dd className="flex flex-col gap-1">
      <strong className="text-2xl font-semibold tracking-tight tabular-nums">{value}</strong>
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
      {href && <Link className="text-xs font-medium text-primary hover:underline" href={href}>{linkLabel} →</Link>}
    </dd>
  </Card>;
}

/** Determinate bar built from segments; widths are shares of `total`. */
export function ProgressBar({ label, total, segments }: { label: string; total: number; segments: { value: number; tone?: "success" | "warning" | "danger" | "muted" }[] }) {
  const tones = { success: "bg-chart-2", warning: "bg-chart-3", danger: "bg-destructive", muted: "bg-chart-5" };
  const done = segments.reduce((sum, segment) => sum + segment.value, 0);
  return <div className="flex h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={Math.max(total, 1)} aria-valuenow={done}>
    {segments.filter(segment => segment.value > 0).map((segment, index) => <span key={index} className={cn("h-full min-w-0.5", segment.tone ? tones[segment.tone] : "bg-primary")} style={{ width: `${total ? segment.value / total * 100 : 0}%` }}/>)}
  </div>;
}

export { Progress };
