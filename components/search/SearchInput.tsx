'use client'

/**
 * SearchInput
 *
 * Search input component with debounced updates.
 */

import { useCallback, useState } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  className
}: SearchInputProps) {
  const t = useTranslations('SearchInput')
  const [localValue, setLocalValue] = useState(value)

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      onChange(localValue)
    },
    [localValue, onChange]
  )

  const handleClear = useCallback(() => {
    setLocalValue('')
    onChange('')
  }, [onChange])

  return (
    <form onSubmit={handleSubmit} className={cn('relative', className)}>
      <div className="relative">
        <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          placeholder={placeholder || t('defaultPlaceholder')}
          className="rounded-xl py-3.5 pl-12 pr-12 shadow-sm"
        />
        {localValue && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </form>
  )
}

export default SearchInput
