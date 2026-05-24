'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Search, ChevronRight, ChevronLeft, Check } from 'lucide-react'

interface DropdownItem {
  id: string
  label: string
  sublabel?: string
  thirdLine?: string
  isHeader?: boolean
  [key: string]: any
}

interface DropdownProps {
  label: string
  placeholder?: string
  items: DropdownItem[]
  onSelect: (item: DropdownItem) => void
  active: boolean
  selectedItem?: DropdownItem | null
  height?: string
  paddingLeft?: string

  // Controlled props
  isOpen: boolean
  onToggle: (isOpen: boolean) => void

  // Header props
  onBack?: () => void
  headerTitle?: string
}

export const Dropdown: React.FC<DropdownProps> = ({
  label,
  placeholder = 'Select...',
  items = [],
  onSelect,
  active,
  selectedItem,
  height = 'py-2.5',
  paddingLeft = 'px-3',
  isOpen,
  onToggle,
  onBack,
  headerTitle
}) => {
  const [search, setSearch] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Handle click outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        onToggle(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, onToggle])

  // Reset search when closed
  useEffect(() => {
    if (!isOpen) {
      setSearch('')
    }
  }, [isOpen])

  if (!active) {
    return (
      <button
        className={`w-full flex items-center justify-between ${paddingLeft} pr-3 ${
          height.includes('h-') ? height : 'py-2.5'
        } bg-muted/50 border border-border rounded-lg text-sm text-muted-foreground cursor-not-allowed text-left transition-colors`}
      >
        <span className="truncate mr-2">{label}</span>
        <ChevronRight size={14} className="text-muted-foreground/70 shrink-0 rotate-90" />
      </button>
    )
  }

  const filteredItems = items.filter((item) =>
    item.label.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div
      className={`relative ${height.includes('h-') ? 'h-full' : ''}`}
      ref={dropdownRef}
    >
      <button
        onClick={() => onToggle(!isOpen)}
        className={`
                    w-full flex items-center justify-between ${paddingLeft} pr-3 ${
                      height.includes('h-') ? 'h-full' : 'py-2.5'
                    } bg-background border rounded-lg text-sm text-left transition-all shadow-sm
                    ${
                      isOpen
                        ? 'border-primary ring-1 ring-primary/20'
                        : 'border-border hover:border-input'
                    }
                    ${
                      selectedItem
                        ? 'text-foreground font-medium'
                        : 'text-muted-foreground'
                    }
                `}
      >
        <span className="truncate mr-2">
          {selectedItem ? selectedItem.label : label}
        </span>
        <ChevronRight
          size={14}
          className={`text-muted-foreground shrink-0 transition-transform ${
            isOpen ? '-rotate-90' : 'rotate-90'
          }`}
        />
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute top-[calc(100%+4px)] left-0 w-full min-w-[320px] bg-background opacity-100 rounded-lg shadow-2xl border border-border z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200 origin-top-left">
          {/* Header: Back Button + Title OR Search */}
          <div className="p-3 border-b border-border flex flex-col gap-2">
            {/* If we have a back action, show header row */}
            {onBack && (
              <div className="flex items-center gap-2 pb-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onBack()
                  }}
                  className="p-1.5 hover:bg-muted rounded-md text-muted-foreground transition-colors bg-muted"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="font-bold text-foreground text-sm">
                  {headerTitle}
                </span>
              </div>
            )}

            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                autoFocus
                type="text"
                className="w-full pl-9 pr-3 py-2 text-sm bg-muted border border-border rounded-md focus:ring-1 focus-visible:ring-ring/50/20 focus-visible:border-ring outline-none text-foreground placeholder:text-muted-foreground transition-all"
                placeholder={
                  onBack ? 'Search...' : `Search ${label.toLowerCase()}...`
                }
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto p-1 bg-background">
            {filteredItems.length > 0 ? (
              filteredItems.map((item) =>
                item.isHeader ? (
                  <div
                    key={item.id}
                    className="px-3 py-1 text-[10px] font-bold text-primary uppercase tracking-wider bg-muted/50 mt-2 mb-1"
                  >
                    {item.label}
                  </div>
                ) : (
                  <button
                    key={item.id}
                    onClick={() => {
                      onSelect(item)
                    }}
                    className={`
                                      w-full text-left px-3 py-2.5 text-sm rounded-md flex items-center justify-between group
                                      ${
                                        selectedItem?.id === item.id
                                          ? 'bg-accent text-primary font-medium'
                                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                      }
                                  `}
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{item.label}</span>
                      {item.sublabel && (
                        <span className="text-xs text-muted-foreground">
                          {item.sublabel}
                        </span>
                      )}
                      {item.thirdLine && (
                        <span className="text-xs text-muted-foreground">
                          {item.thirdLine}
                        </span>
                      )}
                    </div>
                    {selectedItem?.id === item.id ? (
                      <Check size={14} />
                    ) : (
                      <ChevronRight
                        size={14}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground/70"
                      />
                    )}
                  </button>
                )
              )
            ) : (
              <div className="p-4 text-center text-xs text-muted-foreground">
                No results found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
