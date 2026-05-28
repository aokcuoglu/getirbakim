import { ReactNode } from 'react'

interface BrandLayoutProps {
  children: ReactNode
}

export default function BrandLayout({ children }: BrandLayoutProps) {
  return <>{children}</>
}
