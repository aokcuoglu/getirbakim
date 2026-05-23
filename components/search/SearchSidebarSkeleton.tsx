'use client'

import { useTranslations } from 'next-intl'
import { Skeleton } from '@/components/ui/skeleton'
import {
  SidebarContainer,
  SidebarHeader,
  SidebarSection
} from '@/components/ui/sidebar-primitives'

interface SearchSidebarSkeletonProps {
  extraSections?: React.ReactNode
}

export function SearchSidebarSkeleton({ extraSections }: SearchSidebarSkeletonProps) {
  const t = useTranslations('CategoryPage')

  return (
    <SidebarContainer>
      <SidebarHeader>{t('filters')}</SidebarHeader>
      <SidebarSection title={t('brandFilter')}>
        <div className="space-y-2">
          <Skeleton className="h-9 w-full rounded-sm" />
          <div className="space-y-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-8" />
              </div>
            ))}
          </div>
        </div>
      </SidebarSection>
      <SidebarSection title={t('stockFilter')}>
        <div className="space-y-1.5">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-8" />
            </div>
          ))}
        </div>
      </SidebarSection>
      {extraSections}
    </SidebarContainer>
  )
}