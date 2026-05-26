'use client'

import React from 'react'

import { SoonNavTrigger } from '@/components/ui/SoonFeature'

interface CategoryItemProps {
  name: string
  urlKey: string
  isActive: boolean
  onClick: (urlKey: string) => void
  onHover: (urlKey: string) => void
  comingSoon?: boolean
}

export const CategoryItem: React.FC<CategoryItemProps> = ({
  name,
  urlKey,
  isActive,
  onClick,
  onHover,
  comingSoon = false
}) => {
  const className = `whitespace-nowrap transition-colors h-full flex items-center px-1.5 text-[13px] ${
    isActive && !comingSoon
      ? 'text-primary border-b-2 border-primary font-semibold'
      : comingSoon
        ? 'text-muted-foreground'
        : 'hover:text-primary text-foreground cursor-pointer'
  }`

  if (comingSoon) {
    return <SoonNavTrigger className={className}>{name}</SoonNavTrigger>
  }

  return (
    <button
      onClick={() => onClick(urlKey)}
      onMouseEnter={() => onHover(urlKey)}
      onFocus={() => onHover(urlKey)}
      className={`${className} cursor-pointer`}
    >
      {name}
    </button>
  )
}
