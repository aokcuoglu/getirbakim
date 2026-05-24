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
  return <Card className={className}>{children}</Card>
}

export function AdminCardHeader({
  children,
  className
}: {
  children: ReactNode
  className?: string
}) {
  return <CardHeader className={className}>{children}</CardHeader>
}

export function AdminCardTitle({
  children,
  className
}: {
  children: ReactNode
  className?: string
}) {
  return <CardTitle className={className}>{children}</CardTitle>
}

export function AdminCardDescription({
  children,
  className
}: {
  children: ReactNode
  className?: string
}) {
  return <CardDescription className={className}>{children}</CardDescription>
}

export function AdminCardContent({
  children,
  className
}: {
  children: ReactNode
  className?: string
}) {
  return <CardContent className={className}>{children}</CardContent>
}

export function AdminCardFooter({
  children,
  className
}: {
  children: ReactNode
  className?: string
}) {
  return <CardFooter className={className}>{children}</CardFooter>
}
