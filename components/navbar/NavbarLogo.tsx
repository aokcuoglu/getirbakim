'use client'

import React from 'react'
import { Link } from '@/lib/navigation'
import Image from 'next/image'

interface NavbarLogoProps {
  onHomeClick: () => void
  compact?: boolean
  className?: string
}

export const NavbarLogo: React.FC<NavbarLogoProps> = ({
  onHomeClick,
  compact = false,
  className
}) => {
  return (
    <Link
      href="/"
      className={`flex items-center gap-x-1 cursor-pointer group shrink-0 ${className || ''}`}
      onClick={onHomeClick}
    >
      <Image
        src="/logo.png"
        alt="Logo"
        width={0}
        height={0}
        sizes="100vw"
        priority
        className={compact ? 'h-8 w-auto' : 'h-10 w-auto'}
      />
      {!compact && (
        <div className="flex flex-col">
          <p className="tracking-tighter text-xl flex items-baseline font-sans leading-none">
            <span className="font-bold text-primary">Getir</span>
            <span className="font-bold text-foreground ml-px">Bakım</span>
          </p>
          <p className="text-xs text-muted-foreground">getir bi'bakayim</p>
        </div>
      )}
    </Link>
  )
}
