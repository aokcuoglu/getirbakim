import type { ReactNode } from "react";

type Tone = "success" | "error" | "warning" | "info";

/** Result of a server action or a page-level warning; errors are announced assertively. */
export function StatusMessage({ tone = "success", children }: { tone?: Tone; children: ReactNode }) {
  return <p className={`admin-message admin-message-${tone}`} role={tone === "error" ? "alert" : "status"}>{children}</p>;
}

/** Status text with a colored marker; the text itself carries the meaning. */
export function StatusBadge({ tone = "neutral", children }: { tone?: Tone | "neutral"; children: ReactNode }) {
  return <span className={`admin-badge admin-badge-${tone}`}>{children}</span>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="admin-empty"><h3>{title}</h3>{children}</div>;
}

/** Horizontally scrollable, keyboard-focusable region around a data table. */
export function TableRegion({ label, children }: { label: string; children: ReactNode }) {
  return <div className="admin-table-region" role="region" aria-label={label} tabIndex={0}>{children}</div>;
}
