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
        'rounded-2xl border border-slate-100/60 bg-white/80 p-4 shadow-sm backdrop-blur-sm',
        'transition-all duration-200',
        'hover:border-slate-200 hover:shadow-md hover:-translate-y-0.5',
        className
      )}
    >
      {children}
    </article>
  )
}
