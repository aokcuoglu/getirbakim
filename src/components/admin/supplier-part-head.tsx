"use client";

import { useMemo, type ComponentProps } from "react";
import { TableHead, type TableHeadFilter } from "@/components/ui/table";

/**
 * A header filter whose choices are their own labels (brands, groups, currencies) arrives as `values` and gets its
 * `{ value, label }` options here, so the page payload carries each name once instead of twice.
 */
export type SupplierPartFilter = TableHeadFilter & { values?: string[] };

export function SupplierPartHead({ filter, ...props }: Omit<ComponentProps<typeof TableHead>, "filter"> & { filter?: SupplierPartFilter }) {
  const head = useMemo(() => {
    if (!filter) return undefined;
    const { values, ...rest } = filter;
    // An empty value is the option list's "Tümü", so a blank brand cannot be a choice of its own.
    return values ? { ...rest, options: values.filter(Boolean).map(value => ({ value, label: value })) } : rest;
  }, [filter]);
  return <TableHead {...props} filter={head}/>;
}
