'use client'

import { cn } from '@/lib/utils'
import { AdminTableLoadingIndicator } from './admin-table-loading-indicator'

interface AdminTableShellProps {
  children: React.ReactNode
  isLoading?: boolean
  isRefreshing?: boolean
  loadingLabel?: string
  className?: string
}

export function AdminTableShell({
  children,
  isLoading = false,
  isRefreshing = false,
  loadingLabel = 'Veriler güncelleniyor',
  className
}: AdminTableShellProps) {
  const showRefreshOverlay = isLoading || isRefreshing

  return (
    <div
      data-admin-table-shell
      data-loading={showRefreshOverlay || undefined}
      className={cn(
        'relative overflow-hidden rounded-lg border border-border bg-card shadow-sm',
        showRefreshOverlay && [
          'pointer-events-none',
          '[&_[data-slot=table-body]]:opacity-50',
          '[&_[data-slot=table-body]]:transition-opacity',
          '[&_tbody:not([data-slot])]:opacity-50',
          '[&_tbody:not([data-slot])]:transition-opacity'
        ],
        className
      )}
    >
      {showRefreshOverlay ? (
        <AdminTableLoadingIndicator label={loadingLabel} />
      ) : null}
      {children}
    </div>
  )
}
