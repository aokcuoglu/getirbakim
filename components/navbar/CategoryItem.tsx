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
          ? 'text-blue-600 border-b-2 border-blue-600 font-semibold'
          : 'hover:text-blue-600 text-slate-700'
      }`}
    >
      {name}
    </button>
  )
}
