'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Input } from '@/components/ui/input'

export interface AdminFilterOption {
  value: string
  label: string
  groupLabel?: string
}

export function AdminFilterSelect({
  label,
  value,
  options,
  disabled = false,
  placeholder = 'Seçiniz',
  onChange
}: {
  label: string
  value: string
  options: AdminFilterOption[]
  disabled?: boolean
  placeholder?: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value]
  )

  const filteredOptions = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return options
    return options.filter((option) => {
      const haystack = `${option.groupLabel || ''} ${option.label}`.toLowerCase()
      return haystack.includes(term)
    })
  }, [options, query])

  const groupedOptions = useMemo(() => {
    const plain: AdminFilterOption[] = []
    const groups = new Map<string, AdminFilterOption[]>()

    for (const option of filteredOptions) {
      if (!option.groupLabel) {
        plain.push(option)
        continue
      }
      const current = groups.get(option.groupLabel) || []
      current.push(option)
      groups.set(option.groupLabel, current)
    }

    return {
      plain,
      groups: Array.from(groups.entries())
    }
  }, [filteredOptions])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        setQuery('')
      }
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    const frame = requestAnimationFrame(() => {
      const input = inputRef.current
      if (!input) return
      input.focus({ preventScroll: true })
      const cursor = input.value.length
      input.setSelectionRange(cursor, cursor)
    })

    return () => cancelAnimationFrame(frame)
  }, [open, query, filteredOptions.length])

  const handleSelect = (nextValue: string) => {
    onChange(nextValue)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div ref={containerRef} className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((prev) => !prev)}
          className="flex h-8 w-full items-center justify-between rounded-md border border-input bg-background px-2.5 text-sm shadow-xs transition-[color,box-shadow] outline-none hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className={selectedOption ? 'text-foreground' : 'text-muted-foreground'}>
            {selectedOption?.label || placeholder}
          </span>
          <ChevronDown className="size-4 text-muted-foreground opacity-50" />
        </button>

        {open ? (
          <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md">
            <div className="border-b p-2">
              <Input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`${label} ara...`}
                className="h-8 text-xs"
              />
            </div>

            <div className="max-h-80 overflow-y-auto p-1">
              {filteredOptions.length > 0 ? (
                <>
                  {groupedOptions.plain.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleSelect(option.value)}
                      className={`block w-full rounded-sm px-2 py-1.5 text-left text-xs ${
                        value === option.value
                          ? 'bg-accent text-accent-foreground'
                          : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}

                  {groupedOptions.groups.map(([groupLabel, groupOptions], index) => (
                    <div key={groupLabel}>
                      {(groupedOptions.plain.length > 0 || index > 0) && (
                        <div className="my-1 h-px bg-border" />
                      )}
                      <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {groupLabel}
                      </p>
                      {groupOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => handleSelect(option.value)}
                          className={`block w-full rounded-sm px-2 py-1.5 text-left text-xs ${
                            value === option.value
                              ? 'bg-accent text-accent-foreground'
                              : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  ))}
                </>
              ) : (
                <div className="px-2 py-2 text-xs text-muted-foreground">Sonuç bulunamadı.</div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
