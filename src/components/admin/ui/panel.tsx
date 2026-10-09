import type { ReactNode } from "react";

export function AdminPanel({ title, description, actions, id, className, children }: {
  title?: ReactNode; description?: ReactNode; actions?: ReactNode; id?: string; className?: string; children: ReactNode;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return <section className={className ? `admin-panel ${className}` : "admin-panel"} id={id} aria-labelledby={title ? headingId : undefined}>
    {(title || actions) && <header className="admin-panel-header">
      <div>{title && <h2 id={headingId}>{title}</h2>}{description && <p>{description}</p>}</div>
      {actions && <div className="admin-panel-actions">{actions}</div>}
    </header>}
    <div className="admin-panel-body">{children}</div>
  </section>;
}

/** Two-column region for side-by-side panels; stacks below 1000px. */
export function AdminColumns({ children }: { children: ReactNode }) {
  return <div className="admin-grid-2">{children}</div>;
}
