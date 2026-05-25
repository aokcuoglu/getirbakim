import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card'

interface AdminCardProps {
  children: ReactNode
  className?: string
}

export function AdminCard({ children, className }: AdminCardProps) {
  return (
    <Card
      className={cn(
        'gap-3 rounded-lg border-border py-4 shadow-sm',
        className
      )}
    >
      {children}
    </Card>
  )
}

export function AdminCardHeader({
  children,
  className
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <CardHeader className={cn('gap-1 px-3 [.border-b]:pb-3', className)}>
      {children}
    </CardHeader>
  )
}

export function AdminCardTitle({
  children,
  className
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <CardTitle className={cn('text-sm font-medium', className)}>
      {children}
    </CardTitle>
  )
}

export function AdminCardDescription({
  children,
  className
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <CardDescription className={cn('text-xs', className)}>
      {children}
    </CardDescription>
  )
}

export function AdminCardContent({
  children,
  className
}: {
  children: ReactNode
  className?: string
}) {
  return <CardContent className={cn('px-3', className)}>{children}</CardContent>
}

export function AdminCardFooter({
  children,
  className
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <CardFooter className={cn('px-3 [.border-t]:pt-3', className)}>
      {children}
    </CardFooter>
  )
}
