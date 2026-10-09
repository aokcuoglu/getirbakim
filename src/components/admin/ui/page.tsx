import Link from "next/link";
import type { ReactNode } from "react";

export type Crumb = { label: string; href?: string };

/** Content column of an administration route; the surrounding shell comes from app/yonetim/layout.tsx. */
export function AdminPage({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={className ? `admin-page ${className}` : "admin-page"}>{children}</div>;
}

export function AdminPageHeader({ breadcrumbs, eyebrow, title, description, actions }: {
  breadcrumbs?: Crumb[]; eyebrow?: string; title: ReactNode; description?: ReactNode; actions?: ReactNode;
}) {
  return <header className="admin-page-header">
    {breadcrumbs && breadcrumbs.length > 0 && <nav className="admin-breadcrumbs" aria-label="Sayfa yolu"><ol>
      {breadcrumbs.map((crumb, index) => <li key={`${crumb.label}-${index}`}>
        {crumb.href && index < breadcrumbs.length - 1 ? <Link href={crumb.href}>{crumb.label}</Link> : <span aria-current={index === breadcrumbs.length - 1 ? "page" : undefined}>{crumb.label}</span>}
      </li>)}
    </ol></nav>}
    <div className="admin-page-heading">
      <div>{eyebrow && <p className="admin-eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="admin-page-description">{description}</p>}</div>
      {actions && <div className="admin-page-actions">{actions}</div>}
    </div>
  </header>;
}
