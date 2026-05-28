'use client'

import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
type AdminSortBy = string
type AdminSortOrder = 'asc' | 'desc'
import { adminTableHeadClassName } from './admin-table-head'

interface AdminSortableHeadProps {
  label: string
  sortKey: AdminSortBy
  activeSortBy: AdminSortBy
  activeSortOrder: AdminSortOrder
  onSort: (sortBy: AdminSortBy, sortOrder: AdminSortOrder) => void
  className?: string
}

export function AdminSortableHead({
  label,
  sortKey,
  activeSortBy,
  activeSortOrder,
  onSort,
  className
}: AdminSortableHeadProps) {
  const isActive = activeSortBy === sortKey

  const handleClick = () => {
    if (isActive) {
      onSort(sortKey, activeSortOrder === 'asc' ? 'desc' : 'asc')
      return
    }
    onSort(sortKey, 'asc')
  }

  const sortHint = isActive
    ? activeSortOrder === 'asc'
      ? 'A → Z'
      : 'Z → A'
    : 'Sırala'

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'inline-flex items-center gap-1 transition-colors hover:text-foreground',
        adminTableHeadClassName(className),
        isActive && 'text-foreground'
      )}
      aria-label={`${label} ${sortHint}`}
      title={sortHint}
    >
      <span>{label}</span>
      {isActive ? (
        activeSortOrder === 'asc' ? (
          <ArrowUp className="h-3.5 w-3.5" />
        ) : (
          <ArrowDown className="h-3.5 w-3.5" />
        )
      ) : (
        <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
      )}
    </button>
  )
}
