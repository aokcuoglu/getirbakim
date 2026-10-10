import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function StatGrid({ label, children }: { label: string; children: ReactNode }) {
  return <dl className="admin-stats" aria-label={label}>{children}</dl>;
}

/** KPI card. `tone` adds a status dot next to the label; the note or value text carries the meaning. */
export function Stat({ label, value, note, href, linkLabel = "İncele", icon: Icon, tone }: {
  label: string; value: ReactNode; note?: ReactNode; href?: string; linkLabel?: string; icon?: LucideIcon;
  tone?: "success" | "warning" | "danger" | "neutral";
}) {
  return <div className="admin-stat">
    <dt>{Icon && <Icon size={15} aria-hidden="true"/>}{label}{tone && <span className={`admin-stat-tone is-${tone}`} aria-hidden="true" style={{ marginLeft: "auto" }}/>}</dt>
    <dd><strong>{value}</strong>{note && <small>{note}</small>}{href && <Link href={href}>{linkLabel} →</Link>}</dd>
  </div>;
}

/** Determinate bar built from segments; widths are shares of `total`. */
export function ProgressBar({ label, total, segments }: { label: string; total: number; segments: { value: number; tone?: "success" | "warning" | "danger" | "muted" }[] }) {
  const done = segments.reduce((sum, segment) => sum + segment.value, 0);
  return <div className="admin-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={Math.max(total, 1)} aria-valuenow={done}>
    {segments.filter(segment => segment.value > 0).map((segment, index) => <span key={index} className={segment.tone ? `is-${segment.tone}` : undefined} style={{ width: `${total ? segment.value / total * 100 : 0}%` }}/>)}
  </div>;
}
