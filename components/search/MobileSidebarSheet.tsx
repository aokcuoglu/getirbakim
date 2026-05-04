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
          className="lg:hidden flex items-center gap-2 h-10 px-4 border-slate-200 hover:bg-slate-50 text-slate-700 font-medium"
        >
          <Filter size={18} className="text-slate-500" />
          <span>{t('filterBy')}</span>
          {props.activeFilterCount > 0 && (
            <span className="bg-blue-600 text-white text-[11px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px]">
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
          <SheetHeader className="p-6 pb-2 border-b border-slate-100 shrink-0">
            <SheetTitle className="text-left text-lg font-bold text-slate-900 flex items-center gap-2">
              <Filter size={20} className="text-blue-600" />
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
