'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Search, Loader2, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/lib/navigation'
import { useDebounce } from '@/hooks/use-debounce'
import { searchGlobal, SearchResults } from '@/lib/actions/search'
import Image from 'next/image'
import Link from 'next/link'
import { getCategoryImagePath } from '@/lib/utils/category-image'

interface NavbarSearchProps {
  className?: string
  onSearchFocus?: () => void
  mobilePosition?: 'left' | 'right'
}

export const NavbarSearch: React.FC<NavbarSearchProps> = ({
  className,
  onSearchFocus,
  mobilePosition
}) => {
  const t = useTranslations('Navbar')
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [results, setResults] = useState<SearchResults | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const debouncedQuery = useDebounce(query, 300)

  useEffect(() => {
    const performSearch = async () => {
      if (debouncedQuery.length < 2) {
        setResults(null)
        return
      }

      setIsLoading(true)
      try {
        const data = await searchGlobal(debouncedQuery)
        setResults(data)
      } catch (error) {
        console.error('Search error:', error)
      } finally {
        setIsLoading(false)
      }
    }

    performSearch()
  }, [debouncedQuery])

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsFocused(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const handleInputFocus = () => {
    setIsFocused(true)
    if (onSearchFocus) onSearchFocus()
  }

  const handleResultClick = () => {
    setIsFocused(false)
    setQuery('')
  }

  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false)
  const mobileInputRef = useRef<HTMLInputElement>(null)

  // Focus mobile input when opened
  useEffect(() => {
    if (isMobileSearchOpen && mobileInputRef.current) {
      mobileInputRef.current.focus()
    }
  }, [isMobileSearchOpen])

  const closeMobileSearch = () => {
    setIsMobileSearchOpen(false)
    setQuery('')
    setResults(null)
    setIsFocused(false)
  }

  return (
    <>
      {/* Mobile Search Button */}
      <button
        onClick={() => setIsMobileSearchOpen(true)}
        className="md:hidden p-2 hover:bg-slate-50 rounded-lg text-slate-500 hover:text-slate-700 transition-colors"
        aria-label={t('searchPlaceholder')}
      >
        <Search size={20} strokeWidth={1.5} />
      </button>

      {/* Mobile Search Overlay */}
      {isMobileSearchOpen && (
        <div className="fixed inset-0 z-[100] bg-white md:hidden animate-in fade-in duration-150">
          <div className="flex items-center gap-3 px-4 h-16 border-b border-slate-200">
            <button
              onClick={closeMobileSearch}
              className="p-2 -ml-2 text-slate-500 hover:text-slate-700"
            >
              <X size={24} strokeWidth={1.5} />
            </button>
            <div className="flex-1 relative">
              <input
                ref={mobileInputRef}
                type="text"
                placeholder={t('searchPlaceholder')}
                className="w-full bg-slate-100 rounded-lg py-2.5 px-4 pr-10 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                {isLoading ? (
                  <Loader2 size={18} className="animate-spin text-blue-500" />
                ) : query.length > 0 ? (
                  <button
                    onClick={() => setQuery('')}
                    className="hover:text-slate-600"
                  >
                    <X size={18} strokeWidth={1.5} />
                  </button>
                ) : (
                  <Search size={18} strokeWidth={1.5} />
                )}
              </div>
            </div>
          </div>

          {/* Mobile Search Results */}
          <div className="overflow-y-auto h-[calc(100vh-64px)]">
            {/* Default State: Popular Searches */}
            {!query && (
              <div className="p-4">
                <div className="text-xs font-semibold text-slate-400 mb-3 uppercase tracking-wider">
                  {t('popularSearches')}
                </div>
                <div className="flex flex-wrap gap-2">
                  {['brakePads', 'oilFilter', 'sparkPlugs', 'wiperBlades'].map(
                    (tag) => (
                      <span
                        key={tag}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm rounded-full cursor-pointer transition-colors"
                        onClick={() => setQuery(t(`popularTags.${tag}`))}
                      >
                        {t(`popularTags.${tag}`)}
                      </span>
                    )
                  )}
                </div>
              </div>
            )}

            {/* Mobile Results */}
            {query.length >= 2 && results && (
              <div>
                {/* Categories */}
                {results.categories.length > 0 && (
                  <div className="mb-2">
                    <div className="text-xs font-semibold text-slate-500 bg-slate-50 px-4 py-2 uppercase tracking-wider">
                      {t('categories') || 'Categories'}
                    </div>
                    <ul>
                      {results.categories.map((cat) => (
                        <li key={cat.id}>
                          <Link
                            href={`/${cat.slug}`}
                            className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors border-b border-slate-100"
                            onClick={closeMobileSearch}
                          >
                            {getCategoryImagePath(cat.image) ? (
                              <div className="w-10 h-10 relative rounded-lg overflow-hidden bg-white border border-slate-100">
                                <Image
                                  src={getCategoryImagePath(cat.image)!}
                                  alt={cat.name}
                                  fill
                                  className="object-contain p-1"
                                  unoptimized
                                />
                              </div>
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400">
                                <Search size={16} />
                              </div>
                            )}
                            <span className="text-sm font-medium text-slate-700">
                              {cat.name}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Products */}
                {results.products.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-slate-500 bg-slate-50 px-4 py-2 uppercase tracking-wider">
                      {t('products') || 'Products'}
                    </div>
                    <ul>
                      {results.products.map((product) => (
                        <li key={product.id}>
                          <Link
                            href={`/part/${product.urlKey}`}
                            className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors border-b border-slate-100"
                            onClick={closeMobileSearch}
                          >
                            <div className="w-12 h-12 relative rounded-lg bg-gradient-to-br from-slate-100 to-slate-50 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center">
                              {product.image ? (
                                <Image
                                  src={product.image}
                                  alt={product.name}
                                  fill
                                  className="object-contain p-1"
                                />
                              ) : (
                                <span className="text-[10px] font-bold text-slate-500 tracking-tight leading-tight text-center px-0.5">
                                  {product.name.substring(0, 4).toUpperCase()}
                                </span>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm text-slate-700 line-clamp-2">
                                {product.name}
                              </div>
                              <div className="text-xs text-slate-500 truncate">
                                {product.brandName} • {product.categoryName}
                              </div>
                            </div>
                            {product.price && (
                              <div className="font-bold text-sm text-slate-900 whitespace-nowrap">
                                {product.price}
                              </div>
                            )}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {results.categories.length === 0 &&
                  results.products.length === 0 &&
                  !isLoading && (
                    <div className="p-8 text-center text-slate-500">
                      <Search size={32} className="mx-auto mb-3 opacity-20" />
                      <p className="text-sm">No results found for "{query}"</p>
                    </div>
                  )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Desktop Search - Only render if not purely a mobile trigger (mobilePosition unset) */}
      {!mobilePosition && (
        <div
          ref={containerRef}
          className={`hidden md:flex flex-1 max-w-2xl relative z-50 ${className}`}
        >
          <div
            className={`
          flex items-center w-full bg-slate-100/50 backdrop-blur-md rounded-lg transition-all duration-200
          ${
            isFocused
              ? 'bg-white border border-slate-200 shadow-md'
              : 'hover:bg-slate-100/80 border border-slate-200'
          }
        `}
          >
            <input
              type="text"
              placeholder={t('searchPlaceholder')}
              className="w-full bg-transparent border-none focus:ring-0 focus:outline-none outline-none text-sm py-2.5 px-3 text-slate-800 placeholder:text-slate-400 font-light shadow-none"
              onFocus={handleInputFocus}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="pr-4 text-slate-400 flex items-center gap-2">
              {isLoading ? (
                <Loader2 size={18} className="animate-spin text-blue-500" />
              ) : query.length > 0 ? (
                <button
                  onClick={() => setQuery('')}
                  className="hover:text-slate-600"
                >
                  <X size={18} strokeWidth={1.5} />
                </button>
              ) : (
                <Search size={18} strokeWidth={1.5} />
              )}
            </div>
          </div>

          {/* Expanded Search Palette */}
          {isFocused && (
            <div className="absolute top-full left-0 w-full mt-2 bg-white rounded-xl shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 max-h-[80vh] overflow-y-auto">
              {/* Default State: Popular Searches */}
              {!query && (
                <div className="p-2">
                  <div className="text-xs font-semibold text-slate-400 px-3 py-2 uppercase tracking-wider">
                    {t('popularSearches')}
                  </div>
                  <div className="flex flex-wrap gap-2 px-3 pb-3">
                    {[
                      'brakePads',
                      'oilFilter',
                      'sparkPlugs',
                      'wiperBlades'
                    ].map((tag) => (
                      <span
                        key={tag}
                        className="px-3 py-1 bg-slate-50 hover:bg-slate-100 text-slate-600 text-xs rounded-full cursor-pointer border border-slate-200 transition-colors"
                        onClick={() => {
                          setQuery(t(`popularTags.${tag}`)) // Or navigate directly
                          // For now, let's just populate the search
                        }}
                      >
                        {t(`popularTags.${tag}`)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Results State */}
              {query.length >= 2 && results && (
                <div className="pb-2">
                  {/* Categories */}
                  {results.categories.length > 0 && (
                    <div className="mb-2">
                      <div className="text-xs font-semibold text-slate-500 bg-slate-50 px-4 py-2 uppercase tracking-wider">
                        {t('categories') || 'Categories'}
                      </div>
                      <ul>
                        {results.categories.map((cat) => (
                          <li key={cat.id}>
                            <Link
                              href={`/${cat.slug}`}
                              className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 transition-colors"
                              onClick={handleResultClick}
                            >
                              {getCategoryImagePath(cat.image) ? (
                                <div className="w-8 h-8 relative rounded overflow-hidden bg-white border border-slate-100">
                                  <Image
                                    src={getCategoryImagePath(cat.image)!}
                                    alt={cat.name}
                                    fill
                                    className="object-contain p-1"
                                    unoptimized
                                  />
                                </div>
                              ) : (
                                <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center text-slate-400">
                                  <Search size={14} />
                                </div>
                              )}
                              <span className="text-sm font-medium text-slate-700">
                                {cat.name}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Products */}
                  {results.products.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-slate-500 bg-slate-50 px-4 py-2 uppercase tracking-wider">
                        {t('products') || 'Products'}
                      </div>
                      <ul>
                        {results.products.map((product) => (
                          <li key={product.id}>
                            <Link
                              href={`/part/${product.urlKey}`}
                              className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 transition-colors group"
                              onClick={handleResultClick}
                            >
                              <div className="w-10 h-10 relative rounded-lg bg-gradient-to-br from-slate-100 to-slate-50 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center">
                                {product.image ? (
                                  <Image
                                    src={product.image}
                                    alt={product.name}
                                    fill
                                    className="object-contain p-1"
                                  />
                                ) : (
                                  <span className="text-[10px] font-bold text-slate-500 tracking-tight leading-tight text-center px-0.5">
                                    {product.name.substring(0, 4).toUpperCase()}
                                  </span>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm text-slate-700 group-hover:text-blue-600 truncate">
                                  {product.name}
                                </div>
                                <div className="text-xs text-slate-500 truncate">
                                  {product.brandName} • {product.categoryName}
                                </div>
                              </div>
                              {product.price && (
                                <div className="font-bold text-sm text-slate-900 whitespace-nowrap">
                                  {/* TODO: Format price properly */}
                                  {product.price}
                                </div>
                              )}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {results.categories.length === 0 &&
                    results.products.length === 0 &&
                    !isLoading && (
                      <div className="p-8 text-center text-slate-500">
                        <Search size={24} className="mx-auto mb-2 opacity-20" />
                        <p className="text-sm">
                          No results found for "{query}"
                        </p>
                      </div>
                    )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}
