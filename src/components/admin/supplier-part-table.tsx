import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, CircleAlert, CircleCheck, Info, SearchX, TriangleAlert } from "lucide-react";
import { SupplierProductDetails } from "@/components/admin/supplier-product-details";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogTrigger } from "@/components/ui/dialog";
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
};

export type SupplierPartRow = {
  id: string;
  code: string;
  detailHref: string;
  cells: Record<string, SupplierPartCell>;
  details?: Omit<ComponentProps<typeof SupplierProductDetails>, "children" | "code" | "detailHref">;
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

  return <Table>
    <caption className="sr-only">{caption}</caption>
    <TableHeader>
      <TableRow>
        <TableHead scope="col">{codeLabel}</TableHead>
        {columns.map(column => <TableHead key={column.key} scope="col" title={column.title} className={cn(column.align === "right" && "text-right", column.align === "center" && "text-center")}>{column.label}</TableHead>)}
        <TableHead scope="col"><span className="sr-only">Ürün detayı</span></TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>{rows.map(part => {
      const codeButton = <Button variant="link" className="font-mono" title={part.code} aria-label={`${part.code} ürün ayrıntılarını aç`}/>;
      const detailButton = <Button variant="ghost" size="icon" title="Ürün detayını aç" aria-label={`${part.code} ürün detayı`}/>;
      const row = <TableRow key={part.id}>
        <TableCell>
          {part.details ? <DialogTrigger render={codeButton}>{part.code}</DialogTrigger>
            : <Button nativeButton={false} render={<Link href={part.detailHref}/>} variant="link" className="font-mono" title={part.code} aria-label={`${part.code} ürün ayrıntılarını aç`}>{part.code}</Button>}
        </TableCell>
        {columns.map(column => <PartCell key={column.key} column={column} cell={part.cells[column.key]}/>)}
        <TableCell>
          {part.details ? <DialogTrigger render={detailButton}><ArrowUpRight aria-hidden="true"/></DialogTrigger>
            : <Button nativeButton={false} render={<Link href={part.detailHref}/>} variant="ghost" size="icon" title="Ürün detayını aç" aria-label={`${part.code} ürün detayı`}><ArrowUpRight aria-hidden="true"/></Button>}
        </TableCell>
      </TableRow>;

      return part.details ? <SupplierProductDetails key={part.id} {...part.details} code={part.code} detailHref={part.detailHref}>{row}</SupplierProductDetails> : row;
    })}</TableBody>
  </Table>;
}
