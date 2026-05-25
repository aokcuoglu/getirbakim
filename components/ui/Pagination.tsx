'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface PaginationProps {
  currentPage: number
  totalPages: number
  totalItems: number
  itemsPerPage: number
  onPageChange: (page: number) => void
  itemLabel?: string
  showItemCount?: boolean
  previousLabel?: string
  nextLabel?: string
  compact?: boolean
}

export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  onPageChange,
  itemLabel = 'ürün',
  showItemCount = true,
  previousLabel = 'Önceki',
  nextLabel = 'Sonraki',
  compact = false
}: PaginationProps) {
  if (totalPages <= 0) return null

  const startItem = (currentPage - 1) * itemsPerPage + 1
  const endItem = Math.min(currentPage * itemsPerPage, totalItems)

  const getPageNumbers = () => {
    const pages: (number | 'ellipsis')[] = []
    const showEllipsisThreshold = 7

    if (totalPages <= showEllipsisThreshold) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i)
      }
    } else {
      pages.push(1)

      if (currentPage > 3) {
        pages.push('ellipsis')
      }

      const start = Math.max(2, currentPage - 1)
      const end = Math.min(totalPages - 1, currentPage + 1)

      for (let i = start; i <= end; i++) {
        pages.push(i)
      }

      if (currentPage < totalPages - 2) {
        pages.push('ellipsis')
      }

      pages.push(totalPages)
    }

    return pages
  }

  const pageNumbers = getPageNumbers()

  return (
    <div
      className={cn(
        'flex flex-col sm:flex-row sm:items-center',
        compact ? 'gap-2 py-1' : 'gap-3 py-2',
        showItemCount ? 'justify-between' : 'justify-center'
      )}
    >
      {showItemCount ? (
        <p className={cn('text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
          <span className="font-medium text-foreground">
            {startItem}-{endItem}
          </span>{' '}
          / {totalItems} {itemLabel}
        </p>
      ) : null}

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className={cn(
            'rounded-md border-border/60',
            compact && 'h-7 px-2 text-xs'
          )}
          aria-label="Go to previous page"
        >
          <ChevronLeft className="mr-1 size-4" />
          {previousLabel}
        </Button>

        {pageNumbers.map((page, index) =>
          page === 'ellipsis' ? (
            <span key={`ellipsis-${index}`} className="px-2 text-muted-foreground">
              ...
            </span>
          ) : (
            <Button
              key={page}
              variant={currentPage === page ? 'default' : 'outline'}
              size="sm"
              onClick={() => onPageChange(page)}
              className={cn(
                'rounded-md',
                compact ? 'h-7 min-w-[30px] px-1.5 text-xs' : 'min-w-[36px] rounded-md',
                currentPage === page
                  ? ''
                  : 'border-border/60 bg-card'
              )}
            >
              {page}
            </Button>
          )
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className={cn(
            'rounded-md border-border/60',
            compact && 'h-7 px-2 text-xs'
          )}
          aria-label="Go to next page"
        >
          {nextLabel}
          <ChevronRight className="ml-1 size-4" />
        </Button>
      </div>
    </div>
  )
}
