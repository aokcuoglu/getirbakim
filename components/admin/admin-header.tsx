'use client'

import * as React from 'react'
import { ExternalLink, PanelLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Link } from '@/lib/navigation'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

interface AdminHeaderProps {
  onToggleSidebar: () => void
  className?: string
}

export function AdminHeader({ onToggleSidebar, className }: AdminHeaderProps) {
  const [scrolled, setScrolled] = React.useState(false)

  React.useEffect(() => {
    const onScroll = (event: Event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      setScrolled(target.scrollTop > 8)
    }

    const scrollContainer = document.querySelector('[data-admin-scroll]')
    scrollContainer?.addEventListener('scroll', onScroll, { passive: true })
    return () => scrollContainer?.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border/60 bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80',
        scrolled && 'shadow-sm',
        className
      )}
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={onToggleSidebar}
        className="h-8 w-8 shrink-0"
        aria-label="Kenar çubuğunu aç/kapat"
      >
        <PanelLeft className="h-4 w-4" />
      </Button>
      <Separator orientation="vertical" className="hidden h-4 sm:block" />
      <div className="ml-auto flex items-center gap-2">
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" asChild>
          <Link href="/">
            <ExternalLink className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Mağazaya Git</span>
          </Link>
        </Button>
      </div>
    </header>
  )
}
