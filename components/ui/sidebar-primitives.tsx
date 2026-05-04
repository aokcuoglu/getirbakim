'use client'

import { useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'

// --- SidebarContainer ---
export function SidebarContainer({
  children,
  className = '',
  contentClassName = ''
}: {
  children: React.ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <aside
      className={`lg:w-80 shrink-0 rounded-[6px] border border-[#dfe5eb] bg-white p-4 ${className}`}
      style={{ fontFamily: 'var(--font-heading), sans-serif' }}
    >
      <div
        className={`sticky top-28 max-h-[calc(100vh-9rem)] overflow-y-auto pr-1 sidebar-scroll ${contentClassName}`}
      >
        {children}
      </div>
    </aside>
  )
}

// --- SidebarHeader ---
export function SidebarHeader({
  children,
  className = ''
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <h2 className={`mb-4 text-[14px] font-semibold text-[#212b36] ${className}`}>
      {children}
    </h2>
  )
}

// --- SidebarSearch ---
export function SidebarSearch({
  placeholder,
  value,
  onChange,
  className = '',
  inputClassName = '',
  iconClassName = ''
}: {
  placeholder?: string
  value: string
  onChange: (value: string) => void
  className?: string
  inputClassName?: string
  iconClassName?: string
}) {
  return (
    <div className={`relative mb-3 ${className}`}>
      <Search
        size={14}
        className={`absolute left-[11px] top-1/2 -translate-y-1/2 text-[#7b8794] ${iconClassName}`}
      />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`h-[38px] w-full rounded-[6px] border border-[#c4cdd5] bg-white py-[6px] pl-[35px] pr-[10px] text-[13px] text-[#212b36] placeholder:text-[#7b8794] transition-[border-color,box-shadow] focus:border-[#98a6b3] focus:outline-none focus:ring-2 focus:ring-[#eef2f5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#eef2f5] ${inputClassName}`}
      />
    </div>
  )
}

// --- SidebarSection ---
export function SidebarSection({
  title,
  children,
  defaultOpen = false,
  className = ''
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  className?: string
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className={`border-t border-[#e7edf2] pt-3.5 ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between py-0 text-left"
      >
        <span className="text-[14px] font-medium text-[#212b36]">
          {title}
        </span>
        <ChevronDown
          size={14}
          className={`text-[#9aa5b1] transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>
      {isOpen && <div className="mt-3 space-y-0.5">{children}</div>}
    </div>
  )
}

// --- SidebarList ---
// Generic container for lists (links, checkboxes, etc.)
export function SidebarList({
  children,
  className = ''
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`max-h-[min(520px,70vh)] space-y-0 overflow-y-auto pr-1 sidebar-scroll ${className}`}
    >
      {children}
    </div>
  )
}
