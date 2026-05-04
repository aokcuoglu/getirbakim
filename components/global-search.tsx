'use client'

import * as React from 'react'
import { Car, Loader2, Package, Search } from 'lucide-react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from '@/components/ui/command'
import { useDebounce } from 'use-debounce'
import { cn } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import { useParams } from 'next/navigation'
import { useShop } from '@/components/ShopProvider'
import { Button } from '@/components/ui/button'
import { CustomerRequestDialog } from '@/components/customer-requests/CustomerRequestDialog'
import { useTranslations } from 'next-intl'
import { searchGlobal } from '@/lib/actions/search'

interface VehicleDocument {
  id: number
  make: string | null
  model: string | null
  vehicle: string | null
  fuel: string | null
  engine: string | null
  variant: string | null
  full_search_text: string
  [key: string]: any
}

interface PartDocument {
  id: string | number
  name: string
  brandName: string
  categoryName: string | null
  price: string | null
  [key: string]: any
}

interface GlobalSearchProps {
  className?: string
  mobilePosition?: 'left' | 'right'
  onSearchFocus?: () => void
}

export function GlobalSearch({
  className,
  mobilePosition,
  onSearchFocus
}: GlobalSearchProps) {
  const router = useRouter()
  const params = useParams()
  const { selectedVehicle } = useShop()
  const locale = Array.isArray(params?.locale)
    ? params?.locale[0] || 'tr'
    : (params?.locale as string) || 'tr'
  const t = useTranslations('GlobalSearch')
  const selectedVehicleUrlKey = selectedVehicle?.urlKey ?? null

  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [debouncedQuery] = useDebounce(query, 300)
  const [vehicleResults, setVehicleResults] = React.useState<VehicleDocument[]>(
    []
  )
  const [partResults, setPartResults] = React.useState<PartDocument[]>([])
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }
    }

    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  React.useEffect(() => {
    const controller = new AbortController()

    const search = async () => {
      if (!debouncedQuery || debouncedQuery.length < 2) {
        setVehicleResults([])
        setPartResults([])
        setLoading(false)
        return
      }

      setLoading(true)

      try {
        const data = await searchGlobal(debouncedQuery)

        if (controller.signal.aborted) {
          return
        }

        const products = (data.products || []).slice(0, 5)
        setPartResults(
          products.map((product) => ({
            id: product.id,
            name: product.name,
            brandName: product.brandName,
            categoryName: product.categoryName,
            price: product.price
          }))
        )
        // Vehicle index search is disabled while Meilisearch is inactive.
        setVehicleResults([])
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn('Global search fallback error:', error)
        }
        setPartResults([])
        setVehicleResults([])
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    search()

    return () => {
      controller.abort()
    }
  }, [debouncedQuery])

  const handleSelectVehicle = (vehicle: VehicleDocument) => {
    console.log('Selected Vehicle:', vehicle)
    setOpen(false)
    // TODO: Connect to Redux/Context and navigate
  }

  const handleSelectPart = (part: PartDocument) => {
    setOpen(false)
    router.push(`/${locale}/part/${String(part.id)}`)
  }

  const handleSearchParts = () => {
    if (query.trim()) {
      setOpen(false)
      const params = new URLSearchParams()
      params.set('q', query.trim())
      if (selectedVehicleUrlKey) {
        params.set('variant', selectedVehicleUrlKey)
      }
      router.push(`/${locale}/search?${params.toString()}`)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && query.trim()) {
      e.preventDefault()
      handleSearchParts()
    }
  }

  const handleOpen = () => {
    setOpen(true)
    if (onSearchFocus) onSearchFocus()
  }

  return (
    <>
      {/* Mobile Trigger */}
      <button
        onClick={handleOpen}
        className={cn(
          'md:hidden p-2 hover:bg-slate-50 rounded-lg text-slate-500 hover:text-slate-700 transition-colors',
          mobilePosition === 'left' ? '' : 'hidden' // Only show if explicitly enabled for mobile or default position logic
        )}
        aria-label={t('ariaSearch')}
      >
        <Search size={20} strokeWidth={1.5} />
      </button>

      {/* Desktop Trigger */}
      {!mobilePosition && (
        <button
          onClick={handleOpen}
          className={cn(
            'hidden md:flex flex-1 max-w-2xl items-center w-full bg-slate-100/50 backdrop-blur-md rounded-lg border border-slate-200 hover:bg-slate-100/80 transition-all duration-200 px-3 py-2.5 text-sm text-slate-400 font-light shadow-none',
            className
          )}
        >
          <Search size={18} strokeWidth={1.5} className="mr-3" />
          <span className="flex-1 text-left">{t('smartSearch')}</span>
          <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
            <span className="text-xs">⌘</span>K
          </kbd>
        </button>
      )}

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder={t('searchPlaceholder')}
          value={query}
          onValueChange={setQuery}
          onKeyDown={handleKeyDown}
        />
        <CommandList>
          {loading && (
            <div className="flex items-center justify-center p-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {!loading &&
            partResults.length === 0 &&
            vehicleResults.length === 0 &&
            debouncedQuery &&
            debouncedQuery.length >= 2 && (
              <CommandEmpty>
                <div className="flex flex-col items-center gap-2 py-2 text-center">
                  <p>{t('noResults')}</p>
                  <p className="max-w-md text-xs text-muted-foreground">
                    {t('noResultsDescription')}
                  </p>
                  <CustomerRequestDialog
                    requestType="MISSING_PRODUCT"
                    source="MISSING_PRODUCT_MODAL"
                    searchQuery={debouncedQuery}
                    trigger={
                      <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700">
                        {t('requestPart')}
                      </Button>
                    }
                  />
                </div>
              </CommandEmpty>
            )}

          {!loading && !debouncedQuery && (
            <CommandGroup heading={t('quickAccessHeading')}>
              <CommandItem
                onSelect={() => {
                  const params = new URLSearchParams()
                  if (selectedVehicleUrlKey) {
                    params.set('variant', selectedVehicleUrlKey)
                  }
                  const href = params.toString()
                    ? `/${locale}/search?${params.toString()}`
                    : `/${locale}/search`
                  router.push(href)
                }}
              >
                <Package className="mr-2 h-4 w-4" />
                <span>{t('browseAllParts')}</span>
              </CommandItem>
            </CommandGroup>
          )}

          {/* Parts Results */}
          {partResults.length > 0 && (
            <CommandGroup heading={t('partsHeading')} forceMount>
              {partResults.map((part) => (
                <CommandItem
                  key={part.id}
                  value={`part-${part.id}`}
                  onSelect={() => handleSelectPart(part)}
                  forceMount
                >
                  <Package className="mr-2 h-4 w-4" />
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {part.brandName} - {part.name}
                    </span>
                    {part.categoryName && (
                      <span className="text-xs text-muted-foreground">
                        {part.categoryName}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
              {query.trim() && (
                <CommandItem onSelect={handleSearchParts} forceMount>
                  <Search className="mr-2 h-4 w-4" />
                  <span className="text-blue-600">
                    {t('viewAllResultsForQuery', { query })}
                  </span>
                </CommandItem>
              )}
            </CommandGroup>
          )}

          {partResults.length > 0 && vehicleResults.length > 0 && (
            <CommandSeparator />
          )}

          {/* Vehicle Results */}
          {vehicleResults.length > 0 && (
            <CommandGroup heading={t('vehiclesHeading')}>
              {vehicleResults.map((vehicle) => (
                <CommandItem
                  key={vehicle.id}
                  value={`vehicle-${vehicle.id}-${vehicle.full_search_text}`}
                  onSelect={() => handleSelectVehicle(vehicle)}
                >
                  <Car className="mr-2 h-4 w-4" />
                  <span>{vehicle.full_search_text}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  )
}
