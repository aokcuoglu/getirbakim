import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";

/** Link-driven tabs (shadcn "line" tabs look): each tab is a URL, so filters survive reloads and can be shared. */
export function AdminTabs({ label, tabs, className }: { label: string; className?: string; tabs: { href: string; label: ReactNode; count?: number; current?: boolean }[] }) {
  return <nav className={cn("flex gap-1 overflow-x-auto border-b px-3 [scrollbar-width:none]", className)} aria-label={label}>
    {tabs.map(tab => <Link key={tab.href} href={tab.href} scroll={false} aria-current={tab.current ? "page" : undefined}
      className="relative inline-flex shrink-0 items-center gap-2 px-2 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary after:opacity-0 aria-[current=page]:after:opacity-100">
      {tab.label}
      {tab.count !== undefined && <span className="rounded-full bg-muted px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">{new Intl.NumberFormat("tr-TR").format(tab.count)}</span>}
    </Link>)}
  </nav>;
}

/** One row of a settings form: what it is on the left, the control on the right. */
export function SettingRow({ title, description, children }: { title: ReactNode; description?: ReactNode; children: ReactNode }) {
  return <div className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] md:items-center md:gap-6 [&+&]:border-t">
    <div><div className="text-sm font-medium">{title}</div>{description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}</div>
    <div>{children}</div>
  </div>;
}

/** Number input with a visible unit (%, TL, saat) inside the field. */
export function AffixInput({ suffix, className, ...props }: React.ComponentProps<"input"> & { suffix: string }) {
  return <InputGroup className={className}>
    <InputGroupInput className="text-right tabular-nums" {...props}/>
    <InputGroupAddon align="inline-end"><InputGroupText>{suffix}</InputGroupText></InputGroupAddon>
  </InputGroup>;
}

/** Previous/next page control; renders a disabled button when there is no target page. */
export function PagerLink({ href, children }: { href: string | null; children: ReactNode }) {
  return href
    ? <Button variant="outline" size="sm" nativeButton={false} render={<Link href={href} scroll={false}/>}>{children}</Button>
    : <Button variant="outline" size="sm" disabled>{children}</Button>;
}

/** A Link styled as a shadcn button (Base UI needs nativeButton={false} for non-button elements). */
export function ButtonLink({ href, variant = "outline", size = "default", className, children, ...props }: { href: string; variant?: "default" | "outline" | "secondary" | "ghost" | "link"; size?: "default" | "sm" | "lg" | "xs"; className?: string; children: ReactNode; target?: string }) {
  return <Button variant={variant} size={size} className={className} nativeButton={false} render={<Link href={href} {...props}/>}>{children}</Button>;
}
