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
        'rounded-2xl border border-border/60 bg-card/80 p-4 shadow-sm backdrop-blur-sm',
        'transition-all duration-200',
        'hover:border-border hover:shadow-md hover:-translate-y-0.5',
        className
      )}
    >
      {children}
    </article>
  )
}
