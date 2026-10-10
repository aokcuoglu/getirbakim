import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";

export type Crumb = { label: string; href?: string };

/** Content column of an administration route; the surrounding shell comes from app/yonetim/layout.tsx. */
export function AdminPage({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex min-w-0 flex-col gap-5", className)}>{children}</div>;
}

export function AdminPageHeader({ breadcrumbs, title, description, actions }: {
  breadcrumbs?: Crumb[]; eyebrow?: string; title: ReactNode; description?: ReactNode; actions?: ReactNode;
}) {
  return <header className="flex flex-col gap-2">
    {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumb><BreadcrumbList>
      {breadcrumbs.map((crumb, index) => <Fragment key={`${crumb.label}-${index}`}>
        {index > 0 && <BreadcrumbSeparator/>}
        <BreadcrumbItem>{crumb.href && index < breadcrumbs.length - 1
          ? <BreadcrumbLink render={<Link href={crumb.href}/>}>{crumb.label}</BreadcrumbLink>
          : <BreadcrumbPage>{crumb.label}</BreadcrumbPage>}</BreadcrumbItem>
      </Fragment>)}
    </BreadcrumbList></Breadcrumb>}
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  </header>;
}
