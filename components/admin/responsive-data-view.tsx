'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

interface ResponsiveDataViewProps {
  mobile: React.ReactNode
  desktop: React.ReactNode
  mobileClassName?: string
  desktopClassName?: string
}

export function ResponsiveDataView({
  mobile,
  desktop,
  mobileClassName,
  desktopClassName
}: ResponsiveDataViewProps) {
  return (
    <>
      <div className={cn('block md:hidden', mobileClassName)}>{mobile}</div>
      <div className={cn('hidden md:block', desktopClassName)}>{desktop}</div>
    </>
  )
}

export function MobileDataCard({
  className,
  children
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <article
      className={cn(
        'rounded-lg border border-border/60 bg-card p-3',
        'transition-colors duration-200',
        'hover:border-border/80',
        className
      )}
    >
      {children}
    </article>
  )
}
