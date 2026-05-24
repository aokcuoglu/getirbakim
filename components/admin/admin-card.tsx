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
  return <Card className={cn('shadow-sm', className)}>{children}</Card>
}

export function AdminCardHeader({
  children,
  className
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <CardHeader className={cn('space-y-1 p-4 pb-2', className)}>
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
    <CardTitle className={cn('text-sm font-semibold', className)}>
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
  return <CardContent className={cn('p-4 pt-0', className)}>{children}</CardContent>
}

export function AdminCardFooter({
  children,
  className
}: {
  children: ReactNode
  className?: string
}) {
  return <CardFooter className={cn('p-4 pt-0', className)}>{children}</CardFooter>
}
