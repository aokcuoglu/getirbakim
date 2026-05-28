import { ReactNode } from 'react'

interface PartLayoutProps {
  children: ReactNode
}

export default function PartLayout({ children }: PartLayoutProps) {
  return <>{children}</>
}
