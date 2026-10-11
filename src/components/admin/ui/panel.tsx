import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

/** A titled card. `flush` removes the content padding so tables and lists can run edge to edge. */
export function AdminPanel({ title, description, actions, id, className, footer, flush, children }: {
  title?: ReactNode; description?: ReactNode; actions?: ReactNode; id?: string; className?: string; footer?: ReactNode; flush?: boolean; children: ReactNode;
}) {
  const autoId = useId();
  const headingId = `${id ?? autoId}-title`;
  return <Card id={id} role={title ? "region" : undefined} aria-labelledby={title ? headingId : undefined} className={cn("@container/admin-panel min-w-0 gap-0 py-0", className)}>
    {(title || actions) && <CardHeader className="border-b py-4 has-data-[slot=card-action]:grid-cols-1 @min-[36rem]/admin-panel:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
      {title && <CardTitle><h2 id={headingId}>{title}</h2></CardTitle>}
      {description && <CardDescription>{description}</CardDescription>}
      {actions && <CardAction className="col-start-1 row-start-auto row-span-1 flex min-w-0 flex-wrap items-center gap-2 justify-self-start text-sm @min-[36rem]/admin-panel:col-start-2 @min-[36rem]/admin-panel:row-start-1 @min-[36rem]/admin-panel:row-span-2 @min-[36rem]/admin-panel:justify-self-end">{actions}</CardAction>}
    </CardHeader>}
    <CardContent className={cn(flush ? "px-0" : "py-4")}>{children}</CardContent>
    {footer && <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/50 py-3 text-sm text-muted-foreground">{footer}</CardFooter>}
  </Card>;
}

/** Two-column region for side-by-side panels; stacks below the xl breakpoint. */
export function AdminColumns({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <div className={cn("grid items-start gap-4", wide ? "xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]" : "xl:grid-cols-2")}>{children}</div>;
}
