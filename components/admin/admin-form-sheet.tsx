'use client'

import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'

type AdminFormSheetWidth = 'sm' | 'md'

const widthClassMap: Record<AdminFormSheetWidth, string> = {
  sm: 'sm:max-w-[400px]',
  md: 'sm:max-w-[480px]'
}

export interface AdminFormSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  onSave?: () => void
  onClose?: () => void
  saveLabel?: string
  closeLabel?: string
  savingLabel?: string
  isSaving?: boolean
  saveDisabled?: boolean
  formId?: string
  width?: AdminFormSheetWidth
  showSave?: boolean
  showClose?: boolean
  footer?: ReactNode
  footerLayout?: 'stacked' | 'row'
  contentClassName?: string
  bodyClassName?: string
}

export function AdminFormSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  onSave,
  onClose,
  saveLabel = 'Değişiklikleri Kaydet',
  closeLabel = 'Kapat',
  savingLabel = 'Kaydediliyor...',
  isSaving = false,
  saveDisabled = false,
  formId,
  width = 'md',
  showSave = true,
  showClose = true,
  footer,
  footerLayout = 'stacked',
  contentClassName,
  bodyClassName
}: AdminFormSheetProps) {
  const handleClose = () => {
    if (onClose) {
      onClose()
      return
    }
    onOpenChange(false)
  }

  const showFooter =
    Boolean(footer) || (showClose && onOpenChange) || (showSave && onSave)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          'flex h-full w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[480px]',
          widthClassMap[width],
          contentClassName
        )}
      >
        <SheetHeader className="shrink-0 border-b border-border/60 px-5 py-4 text-left">
          <SheetTitle className="text-base font-semibold">{title}</SheetTitle>
          {description ? (
            <SheetDescription className="text-xs sm:text-sm">
              {description}
            </SheetDescription>
          ) : null}
        </SheetHeader>

        <div
          className={cn(
            'min-h-0 flex-1 overflow-y-auto px-5 py-4',
            bodyClassName
          )}
        >
          {children}
        </div>

        {showFooter ? (
          <div className="shrink-0 border-t border-border/60 px-5 py-4">
            {footer ?? (
              <div
                className={cn(
                  'flex gap-2',
                  footerLayout === 'stacked'
                    ? 'flex-col'
                    : 'flex-row justify-end'
                )}
              >
                {showClose ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(
                      'h-8 rounded-md',
                      footerLayout === 'stacked' ? 'w-full' : 'px-3'
                    )}
                    onClick={handleClose}
                    disabled={isSaving}
                    aria-label={closeLabel}
                  >
                    {closeLabel}
                  </Button>
                ) : null}
                {showSave && onSave ? (
                  <Button
                    type={formId ? 'submit' : 'button'}
                    form={formId}
                    size="sm"
                    className={cn(
                      'h-8 rounded-md',
                      footerLayout === 'stacked' ? 'w-full' : 'px-3'
                    )}
                    onClick={formId ? undefined : onSave}
                    disabled={isSaving || saveDisabled}
                    aria-label={isSaving ? savingLabel : saveLabel}
                  >
                    {isSaving ? (
                      <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    ) : null}
                    {isSaving ? savingLabel : saveLabel}
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
