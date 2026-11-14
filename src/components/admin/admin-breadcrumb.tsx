"use client";
import { Fragment } from "react";
import Link from "next/link";
import { useSelectedLayoutSegments } from "next/navigation";
import { adminBreadcrumb } from "@/components/admin/admin-routes";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";

/** Header trail. Reads the children slot only, so an open @modal never changes it. Mobile shows the last two crumbs. */
export function AdminBreadcrumb() {
  const trail = adminBreadcrumb(useSelectedLayoutSegments());
  return <Breadcrumb className="min-w-0"><BreadcrumbList className="flex-nowrap">
    {trail.map((crumb, index) => {
      const last = index === trail.length - 1, hiddenOnMobile = index < trail.length - 2;
      return <Fragment key={crumb.label}>
        {index > 0 && <BreadcrumbSeparator className={hiddenOnMobile ? "hidden md:block" : undefined}/>}
        <BreadcrumbItem className={last ? "min-w-0" : hiddenOnMobile ? "hidden md:inline-flex" : undefined}>
          {last || !crumb.href ? <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
            : <BreadcrumbLink render={<Link href={crumb.href}/>}>{crumb.label}</BreadcrumbLink>}
        </BreadcrumbItem>
      </Fragment>;
    })}
  </BreadcrumbList></Breadcrumb>;
}
