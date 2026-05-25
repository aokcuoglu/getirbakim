'use client'

import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  saveLabel?: string
  savingLabel?: string
  isSaving?: boolean
  saveDisabled?: boolean
  formId?: string
  size?: AdminFormDialogSize
  showSave?: boolean
  footer?: ReactNode
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
  saveLabel = 'Değişiklikleri Kaydet',
  savingLabel = 'Kaydediliyor...',
  isSaving = false,
  saveDisabled = false,
  formId,
  size = '3xl',
  showSave = true,
  footer,
  contentClassName,
  bodyClassName
}: AdminFormDialogProps) {
  const showFooter = Boolean(footer) || (showSave && onSave)

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
          <div className="shrink-0 border-t border-border/60 px-5 py-3">
            {footer ?? (
              <div className="flex justify-end">
                <Button
                  type={formId ? 'submit' : 'button'}
                  form={formId}
                  size="sm"
                  className="h-8 rounded-md px-3"
                  onClick={formId ? undefined : onSave}
                  disabled={isSaving || saveDisabled}
                  aria-label={isSaving ? savingLabel : saveLabel}
                >
                  {isSaving ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  ) : null}
                  {isSaving ? savingLabel : saveLabel}
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
