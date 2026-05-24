'use client'

import { Filter, Loader2, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface AdminTableToolbarProps {
  searchValue: string
  onSearchChange: (value: string) => void
  searchPlaceholder?: string
  isSearchLoading?: boolean
  onRefresh?: () => void
  isRefreshing?: boolean
  onAdvancedFilter?: () => void
  advancedFilterLabel?: string
  className?: string
}

export function AdminTableToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Ara...',
  isSearchLoading = false,
  onRefresh,
  isRefreshing = false,
  onAdvancedFilter,
  advancedFilterLabel = 'Gelişmiş Filtre',
  className
}: AdminTableToolbarProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between',
        className
      )}
    >
      <div className="flex w-full flex-1 flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full max-w-xl">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 pl-8 pr-9"
          />
          {isSearchLoading ? (
            <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : null}
        </div>
        {onRefresh ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="w-full sm:w-auto"
          >
            {isRefreshing ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
            )}
            Yenile
          </Button>
        ) : null}
      </div>

      {onAdvancedFilter ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAdvancedFilter}
          className="w-full sm:w-auto"
        >
          <Filter className="mr-2 h-3.5 w-3.5" />
          {advancedFilterLabel}
        </Button>
      ) : null}
    </div>
  )
}
