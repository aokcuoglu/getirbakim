'use client'

import * as React from 'react'
import { Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip'

export type SoonFeatureVariant = 'section' | 'inline' | 'badge' | 'input' | 'panel'
export type SoonFeatureTone = 'light' | 'dark'

interface SoonFeatureProps {
  children: React.ReactNode
  className?: string
  variant?: SoonFeatureVariant
  tone?: SoonFeatureTone
  enabled?: boolean
  showDescription?: boolean
  /** Accessible label for the blocked region */
  ariaLabel?: string
}

export function SoonBadge({
  tone,
  size = 'default'
}: {
  tone: SoonFeatureTone
  size?: 'default' | 'sm'
}) {
  const t = useTranslations('ComingSoon')

  return (
    <Badge
      className={cn(
        'pointer-events-none border shadow-sm animate-in fade-in zoom-in-95 duration-500',
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs sm:text-sm',
        tone === 'dark'
          ? 'border-amber-300/40 bg-amber-400/15 text-amber-50 backdrop-blur-sm'
          : 'border-amber-200/80 bg-gradient-to-r from-amber-50 to-orange-50 text-amber-900'
      )}
    >
      <Sparkles
        className={cn(
          'animate-pulse',
          size === 'sm' ? 'size-2.5' : 'size-3',
          tone === 'dark' ? 'text-amber-200' : 'text-amber-600'
        )}
        aria-hidden
      />
      {t('badge')}
    </Badge>
  )
}

/** Full-size overlay layer centered in a grid stack or flex parent */
function SoonOverlayCenter({
  tone = 'light',
  showDescription = true,
  size = 'default',
  className,
  scrimClassName
}: {
  tone?: SoonFeatureTone
  showDescription?: boolean
  size?: 'default' | 'compact'
  className?: string
  scrimClassName?: string
}) {
  return (
    <div
      data-soon-overlay
      className={cn(
        'pointer-events-none col-start-1 row-start-1 z-20 flex min-h-full w-full items-center justify-center self-stretch justify-self-stretch p-3 sm:p-4',
        scrimClassName,
        className
      )}
    >
      <SoonOverlayCard tone={tone} showDescription={showDescription} size={size} />
    </div>
  )
}

/** Centered card for overlays in panels, sections, and inline blocks */
function SoonOverlayCard({
  tone = 'light',
  showDescription = true,
  size = 'default',
  className
}: {
  tone?: SoonFeatureTone
  showDescription?: boolean
  size?: 'default' | 'compact'
  className?: string
}) {
  const t = useTranslations('ComingSoon')

  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-2xl border px-5 py-3 text-center shadow-lg backdrop-blur-md animate-in fade-in zoom-in-95 duration-500',
        size === 'compact' ? 'max-w-[85%] px-4 py-2.5' : 'max-w-md',
        tone === 'dark'
          ? 'border-amber-300/30 bg-primary/85 text-primary-foreground'
          : 'border-amber-200/50 bg-background/95',
        className
      )}
    >
      <SoonBadge tone={tone} />
      {showDescription ? (
        <p
          className={cn(
            'px-1 text-xs sm:text-sm',
            tone === 'dark' ? 'text-primary-foreground/80' : 'text-muted-foreground'
          )}
        >
          {t('description')}
        </p>
      ) : null}
    </div>
  )
}

const inertProps = { inert: true } as React.HTMLAttributes<HTMLDivElement>

/** Passive nav control — muted appearance, click shows Yakında or runs a custom handler. */
export function SoonNavTrigger({
  children,
  className,
  onTrigger,
  ariaLabel
}: {
  children: React.ReactNode
  className?: string
  /** Opens external UI (sheet/modal/dropdown) instead of the default dialog */
  onTrigger?: () => void
  ariaLabel?: string
}) {
  const t = useTranslations('ComingSoon')
  const [dialogOpen, setDialogOpen] = React.useState(false)

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    if (onTrigger) {
      onTrigger()
      return
    }
    setDialogOpen(true)
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          'opacity-60 text-muted-foreground transition-colors cursor-pointer',
          className
        )}
        aria-label={ariaLabel ?? t('title')}
      >
        {children}
      </button>
      {!onTrigger ? (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="border-0 bg-transparent p-0 shadow-none sm:max-w-md">
            <DialogTitle className="sr-only">{t('title')}</DialogTitle>
            <SoonPanelBanner />
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}

/** Non-interactive nav label with optional badge — no navigation or link focus. */
export function SoonNavItem({
  children,
  className,
  tone = 'light',
  showBadge = true
}: {
  children: React.ReactNode
  className?: string
  tone?: SoonFeatureTone
  showBadge?: boolean
}) {
  const t = useTranslations('ComingSoon')

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 select-none cursor-not-allowed opacity-60',
        className
      )}
      aria-disabled="true"
      aria-label={t('title')}
    >
      <span className="pointer-events-none">{children}</span>
      {showBadge ? <SoonBadge tone={tone} size="sm" /> : null}
    </span>
  )
}

/** Centered banner for menus, sheets, and dropdown panels */
export function SoonPanelBanner({
  tone = 'light',
  showDescription = true,
  className
}: {
  tone?: SoonFeatureTone
  showDescription?: boolean
  className?: string
}) {
  return (
    <SoonOverlayCard
      tone={tone}
      showDescription={showDescription}
      size="compact"
      className={className}
    />
  )
}

export function SoonFeature({
  children,
  className,
  variant = 'section',
  tone = 'light',
  enabled = true,
  showDescription = true,
  ariaLabel
}: SoonFeatureProps) {
  const t = useTranslations('ComingSoon')

  if (!enabled) {
    return <>{children}</>
  }

  const blockLayer = (
    <div
      className="absolute inset-0 z-10 cursor-not-allowed"
      role="presentation"
      aria-hidden
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    />
  )

  if (variant === 'badge') {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={cn('relative inline-flex', className)}
              aria-label={ariaLabel ?? t('title')}
            >
              <div {...inertProps} className="pointer-events-none select-none opacity-80">
                {children}
              </div>
              <div className="absolute -top-2 -right-2 z-20">
                <SoonBadge tone={tone} size="sm" />
              </div>
              {blockLayer}
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[240px] text-center">
            <p className="font-medium">{t('title')}</p>
            {showDescription ? (
              <p className="mt-0.5 text-background/80">{t('description')}</p>
            ) : null}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  if (variant === 'input') {
    return (
      <div className={cn('relative', className)} aria-label={ariaLabel ?? t('title')}>
        <div
          {...inertProps}
          className="pointer-events-none select-none [&_*]:pointer-events-none opacity-70"
        >
          {children}
        </div>
        {blockLayer}
        <div className="pointer-events-none absolute inset-y-0 right-2 z-20 flex items-center">
          <SoonBadge tone={tone} size="sm" />
        </div>
      </div>
    )
  }

  if (variant === 'panel') {
    return (
      <div
        className={cn('relative grid min-h-0 flex-1', className)}
        aria-label={ariaLabel ?? t('title')}
      >
        <div
          {...inertProps}
          className="pointer-events-none col-start-1 row-start-1 min-h-0 select-none overflow-hidden opacity-55 saturate-[0.9] [&_*]:pointer-events-none"
        >
          {children}
        </div>
        <div
          className={cn(
            'col-start-1 row-start-1 z-10 min-h-full backdrop-blur-[1px]',
            tone === 'dark' ? 'bg-primary/25' : 'bg-background/40'
          )}
          aria-hidden
        />
        <div className="col-start-1 row-start-1 z-10 min-h-full">{blockLayer}</div>
        <SoonOverlayCenter
          tone={tone}
          showDescription={showDescription}
          size="compact"
        />
      </div>
    )
  }

  if (variant === 'inline') {
    return (
      <div
        className={cn('relative grid min-h-[4.5rem]', className)}
        aria-label={ariaLabel ?? t('title')}
      >
        <div
          {...inertProps}
          className="pointer-events-none col-start-1 row-start-1 select-none opacity-75 [&_*]:pointer-events-none"
        >
          {children}
        </div>
        <div className="col-start-1 row-start-1 z-10 min-h-full">{blockLayer}</div>
        <SoonOverlayCenter tone={tone} showDescription={showDescription} />
      </div>
    )
  }

  return (
    <div className={cn('relative grid overflow-hidden', className)} aria-label={ariaLabel ?? t('title')}>
      <div
        {...inertProps}
        className="pointer-events-none col-start-1 row-start-1 select-none opacity-[0.55] saturate-[0.85] [&_*]:pointer-events-none"
      >
        {children}
      </div>
      <div
        className={cn(
          'col-start-1 row-start-1 z-10 min-h-full backdrop-blur-[1px]',
          tone === 'dark'
            ? 'bg-gradient-to-b from-primary/20 via-primary/45 to-primary/65'
            : 'bg-gradient-to-b from-background/30 via-background/50 to-background/70'
        )}
        aria-hidden
      />
      <div className="col-start-1 row-start-1 z-10 min-h-full">{blockLayer}</div>
      <SoonOverlayCenter tone={tone} showDescription={showDescription} />
    </div>
  )
}
