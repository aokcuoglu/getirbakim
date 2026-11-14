import type { ReactNode } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, Info, SearchX, TriangleAlert } from "lucide-react";
import { SupplierPartHead, type SupplierPartFilter } from "@/components/admin/supplier-part-head";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type PartBadgeVariant = "success" | "warning" | "destructive" | "info" | "outline";

export type SupplierPartCell = {
  value: string | number | null | undefined;
  title?: string;
  variant?: PartBadgeVariant;
};

export type SupplierPartColumn = {
  key: string;
  label: ReactNode;
  title?: string;
  align?: "right" | "center";
  width?: "medium" | "wide";
  numeric?: boolean;
  emphasized?: boolean;
  missingLabel?: string;
  /** The list is paginated: header sorting and filtering go to the URL (see TableHead). */
  sortKey?: string;
  filter?: SupplierPartFilter;
};

export type SupplierPartRow = {
  id: string;
  code: string;
  detailHref: string;
  cells: Record<string, SupplierPartCell>;
};

export type SupplierPartTableProps = {
  caption: string;
  columns: SupplierPartColumn[];
  rows: SupplierPartRow[];
  codeLabel?: string;
  emptyDescription?: string;
};

const badgeIcons = {
  success: CircleCheck,
  warning: TriangleAlert,
  destructive: CircleAlert,
  info: Info,
  outline: null,
} satisfies Record<PartBadgeVariant, typeof CircleCheck | null>;

function PartCell({ column, cell }: { column: SupplierPartColumn; cell: SupplierPartCell | undefined }) {
  const missing = cell?.value === null || cell?.value === undefined || cell?.value === "";
  const variant = cell?.variant ?? (missing && column.missingLabel ? "warning" : undefined);
  const value = missing ? column.missingLabel ?? "—" : cell.value;
  const Icon = variant ? badgeIcons[variant] : null;

  return <TableCell
    title={cell?.title}
    className={cn(
      "py-1",
      column.align === "right" ? "text-right" : column.align === "center" ? "text-center" : "max-w-32 truncate",
      column.width === "medium" && "max-w-48",
      column.width === "wide" && "max-w-64",
      column.numeric && "tabular-nums",
      column.emphasized ? "font-medium" : !column.numeric && !variant && "text-muted-foreground",
    )}
  >
    {variant ? <Badge variant={variant}>{Icon && <Icon data-icon="inline-start" aria-hidden="true"/>}{value}</Badge> : value}
  </TableCell>;
}

export function SupplierPartTable({ caption, columns, rows, codeLabel = "Parça kodu", emptyDescription = "Aramayı veya filtreleri değiştirebilirsiniz." }: SupplierPartTableProps) {
  if (!rows.length) return <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon"><SearchX/></EmptyMedia>
      <EmptyTitle>Filtrelere uygun ürün bulunamadı.</EmptyTitle>
      <EmptyDescription>{emptyDescription}</EmptyDescription>
    </EmptyHeader>
  </Empty>;

  return <Table server>
    <caption className="sr-only">{caption}</caption>
    <TableHeader>
      <TableRow>
        <TableHead scope="col" sortKey="code">{codeLabel}</TableHead>
        {columns.map(column => <SupplierPartHead key={column.key} scope="col" title={column.title} sortKey={column.sortKey} filter={column.filter} className={cn(column.align === "right" && "text-right", column.align === "center" && "text-center")}>{column.label}</SupplierPartHead>)}
      </TableRow>
    </TableHeader>
    {/* The code opens the product: in a dialog over the list (@modal/(.)urun/[id]), as its own page on a direct visit.
        No prefetch: 50 detail routes per page would each be fetched for a dialog that is rarely opened. */}
    <TableBody>{rows.map(part => <TableRow key={part.id}>
      <TableCell className="py-1">
        <Button nativeButton={false} render={<Link href={part.detailHref} prefetch={false} scroll={false}/>} variant="link" className="font-mono" title={part.code} aria-label={`${part.code} ürün ayrıntılarını aç`}>{part.code}</Button>
      </TableCell>
      {columns.map(column => <PartCell key={column.key} column={column} cell={part.cells[column.key]}/>)}
    </TableRow>)}</TableBody>
  </Table>;
}
