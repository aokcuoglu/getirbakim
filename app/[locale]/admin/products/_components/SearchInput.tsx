'use client'

import { useState, useEffect, useCallback } from 'react'
import { Search } from 'lucide-react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useDebouncedCallback } from 'use-debounce'

interface SearchInputProps {
  defaultValue?: string
  placeholder?: string
}

export function SearchInput({
  defaultValue = '',
  placeholder = 'Search products...'
}: SearchInputProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [value, setValue] = useState(defaultValue)

  // Debounced search - waits 300ms after typing stops
  const handleSearch = useDebouncedCallback((term: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (term) {
      params.set('q', term)
    } else {
      params.delete('q')
    }
    // Reset to page 1 when searching
    params.delete('page')
    router.push(`${pathname}?${params.toString()}`)
  }, 300)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setValue(newValue)
    handleSearch(newValue)
  }

  // Handle Enter key for immediate search
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch.flush() // Execute immediately
    }
  }

  return (
    <div className="relative flex-1 max-w-md">
      <Search
        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        size={16}
      />
      <input
        type="text"
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className="w-full rounded-md border border-border bg-muted/50 py-2 pl-10 pr-4 text-sm transition-all focus:outline-none focus:ring-2 focus-visible:ring-ring/50/10"
      />
    </div>
  )
}
