import Link from "next/link";
import type { ReactNode } from "react";

/** Link-driven tabs: each tab is a URL, so filters survive reloads and can be shared. */
export function AdminTabs({ label, tabs }: { label: string; tabs: { href: string; label: ReactNode; count?: number; current?: boolean }[] }) {
  return <nav className="admin-tabs" aria-label={label}>
    {tabs.map(tab => <Link key={tab.href} href={tab.href} aria-current={tab.current ? "page" : undefined} scroll={false}>
      {tab.label}{tab.count !== undefined && <span>{new Intl.NumberFormat("tr-TR").format(tab.count)}</span>}
    </Link>)}
  </nav>;
}

/** One row of a settings form: what it is on the left, the control on the right. */
export function SettingRow({ title, description, children }: { title: ReactNode; description?: ReactNode; children: ReactNode }) {
  return <div className="admin-setting"><div><strong>{title}</strong>{description && <p>{description}</p>}</div><div>{children}</div></div>;
}

/** Number input with a visible unit (%, TL, saat) inside the field. */
export function AffixInput({ suffix, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { suffix: string }) {
  return <span className="admin-field-affix"><input {...props}/><span aria-hidden="true">{suffix}</span></span>;
}
