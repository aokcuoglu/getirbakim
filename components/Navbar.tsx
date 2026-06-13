'use client'

import React, { useState, useCallback, useRef } from 'react'
import { Menu } from 'lucide-react'
import { useLocale } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { MegaMenu } from './MegaMenu'
import { PartCategory, TrodoCategory } from '@/lib/actions/getPartCategories'
import { getCachedPartCategories } from '@/lib/client/category-cache'
import { useRouter, usePathname } from '@/lib/navigation'
import { buildCatalogPath } from '@/lib/catalog-url'
import { LoginModal } from './auth/LoginModal'
import { useShop } from './ShopProvider'
import { NavbarLogo } from './navbar/NavbarLogo'
import { GlobalSearch } from './global-search'
import { NavbarActions } from './navbar/NavbarActions'
import { NavbarCategories } from './navbar/NavbarCategories'
import { CatalogSheet } from './CatalogSheet'
import { MobileGarageModal } from './navbar/MobileGarageModal'
import { TopUtilityBar } from './navbar/TopUtilityBar'
import { isV0OnlySite } from '@/lib/v0/siteMode'
import { SoonNavTrigger } from '@/components/ui/SoonFeature'

interface NavbarProps {
  navbarCategories?: PartCategory[]
  onHomeClick?: () => void
  /** @deprecated Navbar reads site mode from env via isV0OnlySite() */
  v0OnlySite?: boolean
}

const Navbar: React.FC<NavbarProps> = ({
  navbarCategories,
  onHomeClick,
  v0OnlySite: _v0OnlySiteProp
}) => {
  const comingSoon = isV0OnlySite()
  const router = useRouter()
  const locale = useLocale()
  const pathname = usePathname() ?? ''
  const searchParams = useSearchParams()
  const segments = pathname.split('/').filter(Boolean)
  const isLocale = (s: string) => s === 'tr' || s === 'en'
  const firstSlug =
    segments.length > 0 && isLocale(segments[0]) ? segments[1] : segments[0]
  const activeCategoryUrlKey =
    firstSlug === 'catalog' ? searchParams.get('cat') : firstSlug ?? null

  const { setUser, refetchUser, selectedVehicle } = useShop()

  // Dropdown States
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isGarageOpen, setIsGarageOpen] = useState(false)
  const [isLanguageOpen, setIsLanguageOpen] = useState(false)

  // Catalog & Categories States
  const [isCatalogOpen, setIsCatalogOpen] = useState(false)
  const [isMegaMenuOpen, setIsMegaMenuOpen] = useState(false)
  const [hoveredCategorySlug, setHoveredCategorySlug] = useState<string | null>(
    null
  )
  const [trodoCategories, setTrodoCategories] = useState<TrodoCategory[]>([])

  // Login Modal State
  const [isLoginOpen, setIsLoginOpen] = useState(false)

  // Mobile States
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isMobileGarageOpen, setIsMobileGarageOpen] = useState(false)

  const categoryTriggerRef = React.useRef<HTMLDivElement>(null)
  const prefetchedCategoryUrlsRef = useRef<Set<string>>(new Set())

  const ensureTrodoCategories = useCallback(async () => {
    if (trodoCategories.length > 0) return
    try {
      const data = await getCachedPartCategories(locale)
      setTrodoCategories(data)
    } catch (error) {
      console.error('Failed to load trodo categories', error)
    }
  }, [locale, trodoCategories.length])

  const closeDropdowns = () => {
    setIsMenuOpen(false)
    setIsGarageOpen(false)
    setIsLanguageOpen(false)
    setIsMegaMenuOpen(false)
    setHoveredCategorySlug(null)
  }

  // Base slugs for categories that open MegaMenu (slug can be full urlKey e.g. car-parts-1000000)
  const MEGAMENU_CATEGORIES = [
    'car-parts',
    'oils-and-fluids',
    'accessories-and-equipment',
    'tools',
    'bicycle-parts'
  ]

  const opensMegaMenu = (urlKey: string) =>
    MEGAMENU_CATEGORIES.some(
      (base) => urlKey === base || urlKey.startsWith(base + '-')
    )

  // Helper to build category URL in catalog shell
  const buildCategoryUrl = (urlKey: string) => {
    const variantSlug =
      (selectedVehicle as { urlKey?: string } | null)?.urlKey ?? null
    return buildCatalogPath({
      categoryUrlKey: urlKey,
      variantSlug
    })
  }

  const handleCategoryHover = useCallback(
    (slug: string) => {
      if (comingSoon) return

      if (opensMegaMenu(slug)) {
        return
      }

      const href = buildCategoryUrl(slug)
      if (prefetchedCategoryUrlsRef.current.has(href)) {
        return
      }

      prefetchedCategoryUrlsRef.current.add(href)
      router.prefetch(href)
    },
    [comingSoon, locale, router, selectedVehicle]
  )

  const handleCategoryClick = (slug: string) => {
    if (comingSoon) return

    // Categories with children open the MegaMenu
    if (opensMegaMenu(slug)) {
      ensureTrodoCategories()

      if (hoveredCategorySlug === slug && isMegaMenuOpen) {
        setIsMegaMenuOpen(false)
        setHoveredCategorySlug(null)
      } else {
        setHoveredCategorySlug(slug)
        setIsMegaMenuOpen(true)
      }
    } else {
      // Navigate directly to the category page, preserving vehicle slug if present
      closeDropdowns()
      router.push(buildCategoryUrl(slug))
    }
  }

  const handleMegaMenuClose = () => {
    setIsMegaMenuOpen(false)
    setHoveredCategorySlug(null)
  }

  // Get categories for MegaMenu based on active slug
  const getMegaMenuCategories = (): TrodoCategory[] => {
    if (!hoveredCategorySlug) return []

    // Find category by urlKey (partial match for simplified slugs)
    const category = trodoCategories.find((c) =>
      c.urlKey?.includes(hoveredCategorySlug)
    )

    // If found, return that category's children, otherwise return all categories
    if (category && category.children && category.children.length > 0) {
      return category.children
    }

    // Return all root categories for the mega menu
    return trodoCategories
  }

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background border-b border-border shadow-sm transition-all duration-300">
        <TopUtilityBar onContactClick={() => closeDropdowns()} />

        {/* 1. TOP ROW: Logo - Search - Actions */}
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-[70px] flex items-center justify-between gap-4 sm:gap-8 relative z-30">
          {/* Mobile Left: Hamburger + Search | Desktop: Logo */}
          <div className="flex items-center gap-1">
            {/* Hamburger Menu - Mobile Only */}
            {comingSoon ? (
              <SoonNavTrigger
                className="md:hidden p-2 rounded-lg"
                onTrigger={() => setIsMobileMenuOpen(true)}
                ariaLabel="Menu"
              >
                <Menu size={24} strokeWidth={1.5} aria-hidden />
              </SoonNavTrigger>
            ) : (
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="md:hidden p-2 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Menu"
            >
              <Menu size={24} strokeWidth={1.5} />
            </button>
            )}

            {/* Mobile Search Button - Next to Hamburger */}
            <GlobalSearch
              onSearchFocus={closeDropdowns}
              mobilePosition="left"
            />

            {/* Desktop Logo - Hidden on Mobile */}
            <div className="hidden md:block">
              <NavbarLogo
                onHomeClick={() => {
                  closeDropdowns()
                  if (onHomeClick) {
                    onHomeClick()
                  } else {
                    router.push('/')
                  }
                }}
              />
            </div>
          </div>

          {/* Mobile Center: Logo (Absolutely Centered) */}
          <div className="md:hidden absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <NavbarLogo
              compact
              onHomeClick={() => {
                closeDropdowns()
                if (onHomeClick) {
                  onHomeClick()
                } else {
                  router.push('/')
                }
              }}
            />
          </div>

          {/* Desktop Search - Hidden on Mobile */}
          <div className="hidden md:flex flex-1 max-w-3xl">
            <GlobalSearch onSearchFocus={closeDropdowns} />
          </div>

          <NavbarActions
            isGarageOpen={isGarageOpen}
            garageComingSoon={comingSoon}
            onGarageOpenChange={(open) => {
              if (open) {
                setIsMenuOpen(false)
                setIsLanguageOpen(false)
              }
              setIsGarageOpen(open)
            }}
            isUserMenuOpen={isMenuOpen}
            onUserMenuOpenChange={(open) => {
              if (open) {
                setIsGarageOpen(false)
                setIsLanguageOpen(false)
              }
              setIsMenuOpen(open)
            }}
            isLanguageOpen={isLanguageOpen}
            onLanguageOpenChange={(open) => {
              if (open) {
                setIsMenuOpen(false)
                setIsGarageOpen(false)
              }
              setIsLanguageOpen(open)
            }}
            closeAllDropdowns={closeDropdowns}
            onLoginClick={() => setIsLoginOpen(true)}
            onMobileGarageClick={() => setIsMobileGarageOpen(true)}
          />
        </div>

        {/* 2. BOTTOM ROW: Catalog Trigger & Categories */}
        <NavbarCategories
          categories={navbarCategories || []}
          isCatalogOpen={isCatalogOpen}
          setIsCatalogOpen={setIsCatalogOpen}
          hoveredCategorySlug={hoveredCategorySlug}
          activeCategoryUrlKey={activeCategoryUrlKey}
          onCategoryClick={handleCategoryClick}
          onCategoryHover={handleCategoryHover}
          closeDropdowns={closeDropdowns}
          categoryTriggerRef={categoryTriggerRef}
          comingSoon={comingSoon}
        />

        {/* Mega Menu - Direct child of fixed nav for better positioning */}
        {!comingSoon && (
        <MegaMenu
          isOpen={isMegaMenuOpen}
          onClose={handleMegaMenuClose}
          activeCategorySlug={hoveredCategorySlug}
          triggerRef={categoryTriggerRef}
          categories={getMegaMenuCategories()}
        />
        )}
      </nav>

      <LoginModal
        open={isLoginOpen}
        onOpenChange={setIsLoginOpen}
        onLoginSuccess={async () => {
          await refetchUser()
          setIsLoginOpen(false)
        }}
      />

      {/* Mobile Menu - Uses CatalogSheet for full category navigation */}
      <CatalogSheet
        open={isMobileMenuOpen}
        onOpenChange={setIsMobileMenuOpen}
        comingSoon={comingSoon}
      />

      {/* Mobile Garage Modal */}
      <MobileGarageModal
        isOpen={isMobileGarageOpen}
        onClose={() => setIsMobileGarageOpen(false)}
        comingSoon={comingSoon}
        onSelectVehicle={() => {
          // Scroll to vehicle selector on the page
          router.push('/')
          setTimeout(() => {
            const element = document.getElementById('vehicle-selector')
            if (element) {
              element.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
          }, 100)
        }}
      />

      {/* Spacer for Fixed Nav: mobile=70px, desktop=150px (32+70+48) */}
      <div className="h-[70px] md:h-[150px]" />
    </>
  )
}

export default Navbar
