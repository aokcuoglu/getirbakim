'use client'

import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

type AdminFormDialogSize = 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl'

const sizeClassMap: Record<AdminFormDialogSize, string> = {
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-xl',
  '2xl': 'sm:max-w-2xl',
  '3xl': 'sm:max-w-3xl',
  '4xl': 'sm:max-w-4xl'
}

export interface AdminFormDialogProps {
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
  size?: AdminFormDialogSize
  showSave?: boolean
  showClose?: boolean
  footer?: ReactNode
  footerLayout?: 'stacked' | 'row'
  contentClassName?: string
  bodyClassName?: string
}

export function AdminFormDialog({
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
  size = '3xl',
  showSave = true,
  showClose = false,
  footer,
  footerLayout = 'row',
  contentClassName,
  bodyClassName
}: AdminFormDialogProps) {
  const handleClose = () => {
    if (onClose) {
      onClose()
      return
    }
    onOpenChange(false)
  }

  const showFooter =
    Boolean(footer) ||
    (showClose && onOpenChange) ||
    (showSave && onSave)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'flex max-h-[92vh] flex-col gap-0 overflow-hidden rounded-lg border-border/60 p-0 shadow-lg sm:max-w-[calc(100%-2rem)]',
          sizeClassMap[size],
          contentClassName
        )}
      >
        <DialogHeader className="shrink-0 border-b border-border/60 px-5 py-4 text-left">
          <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
          {description ? (
            <DialogDescription className="text-xs sm:text-sm">
              {description}
            </DialogDescription>
          ) : null}
        </DialogHeader>

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
              <DialogFooter
                className={cn(
                  'gap-2 p-0',
                  footerLayout === 'stacked'
                    ? 'flex-col sm:flex-col'
                    : 'flex-row flex-nowrap justify-end sm:flex-row'
                )}
              >
                {showClose ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(
                      'h-8 rounded-md transition-colors',
                      footerLayout === 'stacked'
                        ? 'w-full'
                        : 'w-auto shrink-0 px-3'
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
                      'h-8 rounded-md transition-all',
                      footerLayout === 'stacked'
                        ? 'w-full'
                        : 'w-auto shrink-0 px-3'
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
              </DialogFooter>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
