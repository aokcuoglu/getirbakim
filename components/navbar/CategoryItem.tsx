'use client'

import React from 'react'

interface CategoryItemProps {
  name: string
  urlKey: string
  isActive: boolean
  onClick: (urlKey: string) => void
  onHover: (urlKey: string) => void
}

export const CategoryItem: React.FC<CategoryItemProps> = ({
  name,
  urlKey,
  isActive,
  onClick,
  onHover
}) => {
  return (
    <button
      onClick={() => onClick(urlKey)}
      onMouseEnter={() => onHover(urlKey)}
      onFocus={() => onHover(urlKey)}
      className={`whitespace-nowrap transition-colors h-full cursor-pointer flex items-center px-1.5 text-[13px] ${
        isActive
          ? 'text-primary border-b-2 border-primary font-semibold'
          : 'hover:text-primary text-foreground'
      }`}
    >
      {name}
    </button>
  )
}
