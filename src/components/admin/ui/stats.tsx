import Link from "next/link";
import type { ReactNode } from "react";

export function StatGrid({ label, children }: { label: string; children: ReactNode }) {
  return <dl className="admin-stats" aria-label={label}>{children}</dl>;
}

export function Stat({ label, value, note, href, linkLabel = "İncele" }: {
  label: string; value: ReactNode; note?: ReactNode; href?: string; linkLabel?: string;
}) {
  return <div className="admin-stat">
    <dt>{label}</dt>
    <dd><strong>{value}</strong>{note && <small>{note}</small>}{href && <Link href={href}>{linkLabel} →</Link>}</dd>
  </div>;
}
