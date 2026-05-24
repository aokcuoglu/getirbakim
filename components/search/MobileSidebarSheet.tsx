'use client'

import { useTranslations } from 'next-intl'
import { Filter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from '@/components/ui/sheet'
import { SearchSidebarContent, type SearchSidebarProps } from './SearchSidebar'

interface MobileSidebarSheetProps extends SearchSidebarProps {
  activeFilterCount: number
}

/**
 * MobileSidebarSheet - A unified mobile filter trigger and sheet.
 * Use this to consistently show filters on mobile devices.
 */
export function MobileSidebarSheet(props: MobileSidebarSheetProps) {
  const t = useTranslations('CategoryPage')

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          className="lg:hidden flex items-center gap-2 h-10 px-4 border-border hover:bg-muted text-foreground font-medium"
        >
          <Filter size={18} className="text-muted-foreground" />
          <span>{t('filterBy')}</span>
          {props.activeFilterCount > 0 && (
            <span className="bg-primary text-primary-foreground text-[11px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px]">
              {props.activeFilterCount}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-[320px] sm:w-[380px] p-0 border-r-0"
      >
        <div className="flex flex-col h-full">
          <SheetHeader className="p-6 pb-2 border-b border-border shrink-0">
            <SheetTitle className="text-left text-lg font-bold text-foreground flex items-center gap-2">
              <Filter size={20} className="text-primary" />
              {t('filters')}
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-6 sidebar-scroll">
            <SearchSidebarContent {...props} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
