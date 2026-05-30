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
import { motion } from 'framer-motion'
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
import { AdminLoadingState } from '@/components/admin/admin-loading-state'
import { AdminTableEmptyState } from '@/components/admin/data-table/admin-table-empty-state'
import { adminTableHeaderRowClassName } from '@/components/admin/data-table/admin-table-head'
import { AdminTableShell } from '@/components/admin/data-table/admin-table-shell'

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
  getRowClassName?: (row: TData) => string | undefined
  showViewOptions?: boolean
  rowSelection?: Record<string, boolean>
  onRowSelectionChange?: (rowSelection: Record<string, boolean>) => void
  animateRows?: boolean
}

export function DataTable<TData, TValue>({
  columns,
  data,
  getRowId,
  isLoading = false,
  pagination,
  onPaginationChange,
  sorting: externalSorting,
  onSortingChange: onExternalSortingChange,
  toolbarFilterKey,
  toolbarFilterPlaceholder = 'Filtrele...',
  emptyMessage = 'Sonuç bulunamadı.',
  getRowClassName,
  showViewOptions = true,
  rowSelection: externalRowSelection,
  onRowSelectionChange: onExternalRowSelectionChange,
  animateRows = true,
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
  const isInitialLoading = isLoading && data.length === 0
  const isRefreshing = isLoading && data.length > 0

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
      {!toolbarFilterKey && showViewOptions && (
        <DataTableViewOptions table={table} />
      )}
      <AdminTableShell isRefreshing={isRefreshing}>
        {isInitialLoading ? (
          <AdminLoadingState minHeight="min-h-[280px]" />
        ) : (
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className={adminTableHeaderRowClassName()}>
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
              {table.getRowModel().rows?.length ? (
                animateRows ? (
                  table.getRowModel().rows.map((row, idx) => (
                    <motion.tr
                      key={row.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.04, duration: 0.25, ease: [0.25, 0.1, 0.25, 1] as const }}
                      data-slot="table-row"
                      data-state={row.getIsSelected() ? 'selected' : undefined}
                      className={[
                        'border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted',
                        getRowClassName?.(row.original)
                      ].filter(Boolean).join(' ')}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </motion.tr>
                  ))
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      data-state={row.getIsSelected() && 'selected'}
                      className={getRowClassName?.(row.original)}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )
              ) : (
                <TableRow>
                  <TableCell colSpan={colCount} className="h-24 p-0">
                    <AdminTableEmptyState title={emptyMessage} description="" />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </AdminTableShell>
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
