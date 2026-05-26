'use client'

import { Skeleton } from '@/components/ui/skeleton'
import { SidebarContainer } from '@/components/ui/sidebar-primitives'

interface SearchSidebarSkeletonProps {
  extraSections?: React.ReactNode
}

function FilterSectionSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3 border-t border-border pt-3.5">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-9 w-full rounded-sm" />
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-8" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function SearchSidebarSkeleton({ extraSections }: SearchSidebarSkeletonProps) {
  return (
    <SidebarContainer>
      <Skeleton className="mb-4 h-4 w-24" />
      <FilterSectionSkeleton rows={5} />
      <FilterSectionSkeleton rows={2} />
      {extraSections}
    </SidebarContainer>
  )
}
