'use client'

import { useState, useCallback, useEffect } from 'react'
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  useReactTable,
} from '@tanstack/react-table'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { DataTablePagination } from './data-table-pagination'
import { DataTableToolbar } from './data-table-toolbar'
import { DataTableViewOptions } from './data-table-view-options'
import { Skeleton } from '@/components/ui/skeleton'

interface DataTablePaginationInfo {
  page: number
  limit: number
  total: number
  pages: number
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  getRowId?: (row: TData, index: number) => string
  isLoading?: boolean
  skeletonRows?: number
  pagination?: DataTablePaginationInfo
  onPaginationChange?: (page: number) => void
  sorting?: SortingState
  onSortingChange?: (sorting: SortingState) => void
  toolbarFilterKey?: string
  toolbarFilterPlaceholder?: string
  emptyMessage?: string
  rowSelection?: Record<string, boolean>
  onRowSelectionChange?: (rowSelection: Record<string, boolean>) => void
}

export function DataTable<TData, TValue>({
  columns,
  data,
  getRowId,
  isLoading = false,
  skeletonRows = 8,
  pagination,
  onPaginationChange,
  sorting: externalSorting,
  onSortingChange: onExternalSortingChange,
  toolbarFilterKey,
  toolbarFilterPlaceholder = 'Filtrele...',
  emptyMessage = 'Sonuç bulunamadı.',
  rowSelection: externalRowSelection,
  onRowSelectionChange: onExternalRowSelectionChange,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>(externalSorting ?? [])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>(externalRowSelection ?? {})

  useEffect(() => {
    if (externalRowSelection) setRowSelection(externalRowSelection)
  }, [externalRowSelection])

  const handleSortingChange = useCallback(
    (updater: SortingState | ((old: SortingState) => SortingState)) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater
      setSorting(next)
      onExternalSortingChange?.(next)
    },
    [sorting, onExternalSortingChange],
  )

  const handleRowSelectionChange = useCallback(
    (updater: Record<string, boolean> | ((old: Record<string, boolean>) => Record<string, boolean>)) => {
      const next = typeof updater === 'function' ? updater(rowSelection) : updater
      setRowSelection(next)
      onExternalRowSelectionChange?.(next)
    },
    [rowSelection, onExternalRowSelectionChange],
  )

  const table = useReactTable({
    data,
    columns,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    onSortingChange: handleSortingChange,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: handleRowSelectionChange,
    manualSorting: !!onExternalSortingChange,
    manualPagination: true,
    state: {
      sorting: externalSorting ?? sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
    },
  })

  const colCount = table.getAllColumns().length

  const handlePageChange = useCallback(
    (page: number) => onPaginationChange?.(page),
    [onPaginationChange],
  )

  return (
    <div className="space-y-4">
      {toolbarFilterKey && (
        <DataTableToolbar
          table={table}
          filterKey={toolbarFilterKey}
          filterPlaceholder={toolbarFilterPlaceholder}
        />
      )}
      {!toolbarFilterKey && (
        <DataTableViewOptions table={table} />
      )}
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} colSpan={header.colSpan}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: skeletonRows }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: colCount }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={colCount} className="h-24 text-center">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {pagination && (
        <DataTablePagination
          table={table}
          totalRows={pagination.total}
          page={pagination.page}
          pages={pagination.pages}
          onPageChange={handlePageChange}
        />
      )}
    </div>
  )
}
