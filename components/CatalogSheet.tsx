'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import {
  ChevronRight,
  ChevronLeft,
  X,
  User,
  Info,
  Search,
  Car,
  LogOut
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { LoginModal } from '@/components/auth/LoginModal'
import {
  PartCategory
} from '@/lib/actions/getPartCategories'
import {
  getCachedPartCategories,
  getCachedPartCategoriesForVehicle
} from '@/lib/client/category-cache'
import { useRouter } from '@/lib/navigation'
import { useShop } from '@/components/ShopProvider'
import { useTranslations, useLocale } from 'next-intl'
import { buildCatalogPath } from '@/lib/catalog-url'
import { resolveVehicleTypeId } from '@/lib/utils/vehicleSlug'
import { Input } from '@/components/ui/input'
import { SoonFeature } from '@/components/ui/SoonFeature'

interface CatalogSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  comingSoon?: boolean
}

// Interface for flattened search results
interface SearchResult extends PartCategory {
  breadcrumbs: PartCategory[]
}

export const CatalogSheet: React.FC<CatalogSheetProps> = ({
  open,
  onOpenChange,
  comingSoon = false
}) => {
  const t = useTranslations('CatalogSheet')
  const locale = useLocale()
  const router = useRouter()

  // Helper to get localized category name
  const getCategoryName = useCallback((cat: PartCategory) => {
    if (locale === 'tr' && cat.nameTr) {
      return cat.nameTr
    }
    return cat.name
  }, [locale])
  
  const { selectedVehicle, user, setUser } = useShop()
  const selectedVehicleUrlKey =
    (selectedVehicle as { urlKey?: string } | null)?.urlKey
  const selectedVehicleTypeId = resolveVehicleTypeId(selectedVehicle)
  const [categories, setCategories] = useState<PartCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [path, setPath] = useState<PartCategory[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isVehicleFiltered, setIsVehicleFiltered] = useState(false)

  // Helper to build category URL in catalog shell
  const buildCategoryUrl = (urlKey: string) => {
    return buildCatalogPath({
      categoryUrlKey: urlKey,
      variantSlug: selectedVehicleUrlKey ?? null
    })
  }

  // Flatten all categories for deep search
  const flattenCategories = useMemo(() => {
    const results: SearchResult[] = []
    
    const traverse = (items: PartCategory[], breadcrumbs: PartCategory[] = []) => {
      items.forEach(item => {
        results.push({
          ...item,
          breadcrumbs: [...breadcrumbs]
        })
        if (item.children && item.children.length > 0) {
          traverse(item.children, [...breadcrumbs, item])
        }
      })
    }
    
    traverse(categories)
    return results
  }, [categories])

  useEffect(() => {
    if (!open) return

    const fetchCategories = async () => {
      setLoading(true)
      try {
        // If a vehicle is selected, fetch categories for the canonical vehicle type id.
        if (selectedVehicleTypeId) {
          const data = await getCachedPartCategoriesForVehicle(
            selectedVehicleTypeId,
            locale
          )
          setCategories(data)
          setIsVehicleFiltered(true)
        } else {
          const data = await getCachedPartCategories(locale)
          setCategories(data)
          setIsVehicleFiltered(false)
        }
      } catch (error) {
        console.error('Failed to load categories', error)
        // Fallback to all categories
        try {
          const data = await getCachedPartCategories(locale)
          setCategories(data)
          setIsVehicleFiltered(false)
        } catch {
          // Silent fail
        }
      } finally {
        setLoading(false)
      }
    }
    fetchCategories()
  }, [open, selectedVehicleTypeId, locale])

  // Derived state
  const currentCategory = path[path.length - 1] || null
  const currentItems = currentCategory
    ? currentCategory.children || []
    : categories || []
  const isRoot = path.length === 0

  // Deep search across all categories when searching
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) {
      // Sort current items by localized name
      return [...currentItems].sort((a, b) => 
        getCategoryName(a).localeCompare(getCategoryName(b), locale)
      )
    }
    
    const query = searchQuery.toLowerCase()
    
    // Search all categories (deep search)
    const results = flattenCategories.filter(item => {
      const name = getCategoryName(item).toLowerCase()
      return name.includes(query)
    })
    
    // Sort results by localized name
    return results.sort((a, b) => 
      getCategoryName(a).localeCompare(getCategoryName(b), locale)
    )
  }, [searchQuery, currentItems, flattenCategories, locale, getCategoryName])

  // Check if we're showing search results (flattened with breadcrumbs)
  const isSearching = searchQuery.trim().length > 0

  const handleSelect = (item: PartCategory | SearchResult) => {
    // If this is a search result with breadcrumbs, navigate directly
    if (isSearching && 'breadcrumbs' in item) {
      // Navigate to leaf category
      if (item.urlKey) {
        router.push(buildCategoryUrl(item.urlKey))
        onOpenChange(false)
      } else if (item.children && item.children.length > 0) {
        // Set path to this category's breadcrumbs + itself
        setPath([...item.breadcrumbs, item])
        setSearchQuery('')
      }
      return
    }
    
    // Has loaded children - drill down
    if (item.children && item.children.length > 0) {
      setPath([...path, item])
      setSearchQuery('')
      return
    }
    
    // Leaf category - navigate to category page using urlKey (includes category id)
    if (item.urlKey) {
      router.push(buildCategoryUrl(item.urlKey))
      onOpenChange(false)
    }
  }

  const handleCategoryHover = (item: PartCategory | SearchResult) => {
    if (!item.urlKey) return
    router.prefetch(buildCategoryUrl(item.urlKey))
  }

  const handleBack = () => {
    setPath(path.slice(0, -1))
  }

  const handleLogout = async () => {
    setUser(null)
    onOpenChange(false)
    const { signOut } = await import('next-auth/react')
    await signOut({ redirect: false })
    router.refresh()
  }

  const catalogNavContent = (
    <>
      <div className="px-4 py-3 bg-background">
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="text"
            placeholder={t('search')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            readOnly={comingSoon}
            className="pl-9"
          />
        </div>
      </div>

      {isVehicleFiltered && selectedVehicle && (
        <div className="px-4 py-2 bg-accent border-b border-border flex items-center gap-2 text-xs text-primary">
          <Car size={14} />
          <span className="font-medium">
            {selectedVehicle.make} {selectedVehicle.model} {selectedVehicle.year}
          </span>
          <span className="text-primary">{t('filteredByVehicle') || 'için filtrelendi'}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto bg-background">
        {loading ? (
          <div className="p-8 text-center text-muted-foreground">
            {t('loadingCategories')}
          </div>
        ) : (
          <div className="flex flex-col">
            {filteredItems.map((item) => {
              const searchResult = item as SearchResult
              const hasBreadcrumbs =
                isSearching &&
                'breadcrumbs' in searchResult &&
                searchResult.breadcrumbs.length > 0

              const rowContent = (
                <>
                  {hasBreadcrumbs && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                      {searchResult.breadcrumbs.map((bc, idx) => (
                        <React.Fragment key={bc.id}>
                          {idx > 0 && <ChevronRight size={10} />}
                          <span>{getCategoryName(bc)}</span>
                        </React.Fragment>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center justify-between w-full">
                    <span className="text-foreground text-sm">
                      {getCategoryName(item)}
                    </span>
                    {item.children && item.children.length > 0 && (
                      <ChevronRight size={16} className="text-muted-foreground" />
                    )}
                  </div>
                </>
              )

              if (comingSoon) {
                return (
                  <div
                    key={item.id}
                    className="group flex flex-col px-6 py-3 text-left"
                  >
                    {rowContent}
                  </div>
                )
              }

              return (
                <button
                  key={item.id}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => handleCategoryHover(item)}
                  onFocus={() => handleCategoryHover(item)}
                  className="group flex flex-col px-6 py-3 hover:bg-muted transition-colors text-left"
                >
                  {rowContent}
                </button>
              )
            })}

            {filteredItems.length === 0 && (
              <div className="p-8 text-center text-muted-foreground text-sm">
                {searchQuery ? t('noResults') : t('noSubcategories')}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )

  const footerContent = (
    <div className="mt-auto border-t border-border bg-background shrink-0">
      {!user && (
        <LoginModal
          onLoginSuccess={(loggedInUser) => {
            setUser(loggedInUser)
          }}
        >
          <button className="w-full flex items-center gap-3 px-6 py-4 hover:bg-muted text-foreground font-medium text-sm">
            <div className="w-8 flex justify-center">
              <User size={20} />
            </div>
            {t('logIn')}
          </button>
        </LoginModal>
      )}
      {user && (
        <>
          <button
            onClick={() => {
              onOpenChange(false)
              router.push('/account')
            }}
            className="w-full flex items-center gap-3 px-6 py-4 hover:bg-muted text-foreground font-medium text-sm"
          >
            <div className="w-8 flex justify-center">
              <User size={20} className="text-primary" />
            </div>
            <div className="flex flex-col items-start">
              <span>
                {t('hello')}, {user.name || 'User'}
              </span>
              <span className="text-xs text-muted-foreground">{t('myAccount')}</span>
            </div>
            <ChevronRight size={16} className="ml-auto text-muted-foreground/70" />
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-6 py-4 hover:bg-muted text-destructive font-medium text-sm"
          >
            <div className="w-8 flex justify-center">
              <LogOut size={20} />
            </div>
            {t('logout')}
          </button>
        </>
      )}
      <button className="w-full flex items-center gap-3 px-6 py-4 hover:bg-muted text-destructive font-medium text-sm">
        <div className="w-8 flex justify-center">
          <Info size={20} />
        </div>
        {t('contactUs')}
        <ChevronRight size={16} className="ml-auto text-muted-foreground/70" />
      </button>
    </div>
  )

  return (
    <Sheet
      open={open}
      onOpenChange={(val) => {
        onOpenChange(val)
        if (!val) setTimeout(() => setPath([]), 300)
      }}
    >
      <SheetContent
        side="left"
        showCloseButton={false}
        className="w-full sm:w-[400px] p-0 border-r-0 flex flex-col gap-0"
      >
        <SheetTitle className="sr-only">{t('catalogCategories')}</SheetTitle>
        {/* HEADER */}
        <div className="bg-primary bg-[url('/catalog-header-bg.png')] bg-cover bg-center text-primary-foreground flex flex-col">
          {/* Top Bar: Back/Close & Title */}
          <div className="flex items-center justify-between px-4 h-16 shrink-0 relative">
            {isRoot ? (
              <h2 className="text-xl font-bold tracking-tight">
                {t('categories')}
              </h2>
            ) : (
              <button
                onClick={handleBack}
                className="p-1 hover:bg-primary/90 rounded-full transition-colors absolute left-3"
              >
                <ChevronLeft size={24} />
              </button>
            )}

            {!isRoot && (
              <h2 className="text-lg font-bold tracking-tight mx-auto px-8 truncate">
                {currentCategory && getCategoryName(currentCategory)}
              </h2>
            )}

            <button
              onClick={() => onOpenChange(false)}
              className="p-1.5 hover:bg-primary/90 rounded text-muted-foreground hover:text-primary-foreground transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Breadcrumbs */}
          <div className="px-4 pb-4">
            {isRoot ? (
              <div className="flex items-center gap-4 text-sm font-medium text-muted-foreground/70">
                <div className="flex items-center gap-2 cursor-pointer hover:text-primary-foreground">
                  <span className="text-lg">🇫🇷</span> France
                </div>
                <div className="flex items-center gap-1 cursor-pointer hover:text-primary-foreground">
                  EUR <ChevronLeft size={12} className="-rotate-90" />
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap">
                <span
                  className="cursor-pointer hover:text-primary-foreground/80"
                  onClick={() => setPath([])}
                >
                  {t('carParts')}
                </span>
                {path.map((node, i) => (
                  <React.Fragment key={node.id}>
                    <ChevronRight size={10} />
                    <span
                      className={cn(
                        'cursor-pointer hover:text-primary-foreground/80',
                        i === path.length - 1 && 'text-primary-foreground/80 font-semibold'
                      )}
                    >
                      {getCategoryName(node)}
                    </span>
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Catalog navigation */}
        {comingSoon ? (
          <SoonFeature variant="panel" className="min-h-0 flex-1">
            {catalogNavContent}
          </SoonFeature>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">{catalogNavContent}</div>
        )}

        {/* Account & support — always functional */}
        {isRoot && footerContent}
      </SheetContent>
    </Sheet>
  )
}
