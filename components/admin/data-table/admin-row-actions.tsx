'use client'

import * as React from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Link } from '@/lib/navigation'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export interface AdminRowAction {
  label: React.ReactNode
  onClick?: () => void
  href?: string
  disabled?: boolean
  destructive?: boolean
  icon?: React.ReactNode
  separatorBefore?: boolean
  hidden?: boolean
}

interface AdminRowActionsProps {
  actions: AdminRowAction[]
  srLabel?: string
  align?: 'start' | 'center' | 'end'
  className?: string
}

export function AdminRowActions({
  actions,
  srLabel = 'Aksiyonlar',
  align = 'end',
  className
}: AdminRowActionsProps) {
  const visibleActions = actions.filter((action) => !action.hidden)

  if (visibleActions.length === 0) {
    return null
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn('h-8 w-8 rounded-sm', className)}
        >
          <MoreHorizontal className="h-4 w-4" />
          <span className="sr-only">{srLabel}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-[8rem]">
        {visibleActions.map((action, index) => (
          <React.Fragment key={`${String(action.label)}-${index}`}>
            {action.separatorBefore ? <DropdownMenuSeparator /> : null}
            {action.href ? (
              <DropdownMenuItem asChild disabled={action.disabled}>
                <Link
                  href={action.href}
                  className={cn(
                    'flex cursor-default items-center gap-2',
                    action.destructive && 'text-destructive focus:text-destructive'
                  )}
                >
                  {action.icon}
                  {action.label}
                </Link>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                disabled={action.disabled}
                onClick={action.onClick}
                className={cn(
                  'gap-2',
                  action.destructive && 'text-destructive focus:text-destructive'
                )}
              >
                {action.icon}
                {action.label}
              </DropdownMenuItem>
            )}
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
