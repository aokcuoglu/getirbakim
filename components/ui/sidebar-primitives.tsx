'use client'

import { useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ExpandCollapse, RotatingChevron } from '@/components/ui/animations'

export function SidebarContainer({
  children,
  className = '',
  contentClassName = ''
}: {
  children: React.ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <aside
      className={cn('lg:w-80 shrink-0 rounded-md border border-border bg-card p-4', className)}
    >
      <div
        className={cn(
          'sticky top-28 max-h-[calc(100vh-9rem)] overflow-y-auto pr-1 sidebar-scroll',
          contentClassName
        )}
      >
        {children}
      </div>
    </aside>
  )
}

export function SidebarHeader({
  children,
  className = ''
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <h2 className={cn('mb-4 text-sm font-semibold text-foreground', className)}>
      {children}
    </h2>
  )
}

export function SidebarSearch({
  placeholder,
  value,
  onChange,
  className = '',
  inputClassName = '',
  iconClassName = ''
}: {
  placeholder?: string
  value: string
  onChange: (value: string) => void
  className?: string
  inputClassName?: string
  iconClassName?: string
}) {
  return (
    <div className={cn('relative mb-3', className)}>
      <Search
        className={cn(
          'absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground',
          iconClassName
        )}
      />
      <Input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn('pl-9', inputClassName)}
      />
    </div>
  )
}

export function SidebarSection({
  title,
  children,
  defaultOpen = false,
  className = ''
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  className?: string
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className={cn('border-t border-border pt-3.5', className)}>
      <Button
        type="button"
        variant="ghost"
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-auto w-full items-center justify-between px-0 py-0 text-left hover:bg-transparent"
      >
        <span className="text-sm font-medium text-foreground">{title}</span>
        <RotatingChevron
          isExpanded={isOpen}
          className="size-4 shrink-0 text-muted-foreground"
        />
      </Button>
      <ExpandCollapse isOpen={isOpen}>
        <div className="mt-3 space-y-0.5">{children}</div>
      </ExpandCollapse>
    </div>
  )
}

export function SidebarList({
  children,
  className = ''
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'max-h-[min(520px,70vh)] space-y-0 overflow-y-auto pr-1 sidebar-scroll',
        className
      )}
    >
      {children}
    </div>
  )
}
