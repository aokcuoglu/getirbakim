'use client'

import React, { useState, useMemo } from 'react'
import { Link } from '@/lib/navigation'
import {
  Info,
  Car,
  FileText,
  Shuffle,
  ChevronRight,
  ChevronDown,
  RotateCcw
} from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useTranslations } from 'next-intl'
import {
  PRODUCT_SPEC_KEYS,
  PRODUCT_SPEC_VALUE_KEYS
} from '@/lib/product-card-i18n'

interface ProductTabsProps {
  properties: {
    key: string
    value: string
  }[]
  infos: string[]
  oens: {
    brand: string
    code: string
  }[]
  compatibleVehicles: {
    id: number
    brandName: string
    modelName: string
    vehicleName: string
    typeName: string
    yearFrom: string | null
    yearTo: string | null
  }[]
  crossReferences: {
    brandName: string
    articleNumber: string
    supplierProductId?: number | null
    partId?: number | null
  }[]
}

type TabKey = 'technical' | 'vehicles' | 'oem' | 'crossRefs'

type GroupedCrossReference = {
  articleNumber: string
  supplierProductId: number | null
  providerCode: string | null
  partId: number | null
}

function normalizeCrossRefToken(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '')
}

function resolveProviderCodeFromBrand(brandName: string): string | null {
  const normalized = brandName.trim().toUpperCase()
  if (normalized.includes('SETA')) return 'seta'
  if (normalized.includes('DINAMIK')) return 'dinamik'
  return null
}

// Group vehicles by Brand + Model
interface VehicleGroup {
  key: string
  brandName: string
  modelName: string
  subGroups: {
    key: string
    vehicleName: string
    types: {
      id: number
      typeName: string
      yearFrom: string | null
      yearTo: string | null
    }[]
  }[]
}

export function ProductTabs({
  properties,
  infos,
  oens,
  compatibleVehicles,
  crossReferences
}: ProductTabsProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('technical')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [expandedSubGroups, setExpandedSubGroups] = useState<Set<string>>(
    new Set()
  )
  const [selectedMake, setSelectedMake] = useState<string>('')
  const [selectedModel, setSelectedModel] = useState<string>('')
  const t = useTranslations('Part')
  const tProductCard = useTranslations('ProductCard')

  // Get unique makes for filter dropdown
  const uniqueMakes = useMemo(() => {
    const makes = Array.from(
      new Set(compatibleVehicles.map((v) => v.brandName))
    )
    return makes.sort()
  }, [compatibleVehicles])

  // Group vehicles by Brand + Model -> Vehicle Name -> Types
  const groupedVehicles = useMemo(() => {
    const groups: Record<
      string,
      {
        key: string
        brandName: string
        modelName: string
        subGroups: Record<
          string,
          {
            key: string
            vehicleName: string
            types: any[]
          }
        >
      }
    > = {}

    compatibleVehicles.forEach((vehicle) => {
      const groupKey = `${vehicle.brandName}|${vehicle.modelName}`
      const subGroupKey = vehicle.vehicleName

      if (!groups[groupKey]) {
        groups[groupKey] = {
          key: groupKey,
          brandName: vehicle.brandName,
          modelName: vehicle.modelName,
          subGroups: {}
        }
      }

      if (!groups[groupKey].subGroups[subGroupKey]) {
        groups[groupKey].subGroups[subGroupKey] = {
          key: subGroupKey,
          vehicleName: vehicle.vehicleName,
          types: []
        }
      }

      groups[groupKey].subGroups[subGroupKey].types.push({
        id: vehicle.id,
        typeName: vehicle.typeName,
        yearFrom: vehicle.yearFrom,
        yearTo: vehicle.yearTo
      })
    })

    return Object.values(groups).map((group) => ({
      ...group,
      subGroups: Object.values(group.subGroups)
    }))
  }, [compatibleVehicles])

  // Get unique models based on selected make
  const uniqueModels = useMemo(() => {
    let vehicles = compatibleVehicles
    if (selectedMake) {
      vehicles = vehicles.filter((v) => v.brandName === selectedMake)
    }
    const models = Array.from(new Set(vehicles.map((v) => v.modelName)))
    return models.sort()
  }, [compatibleVehicles, selectedMake])

  const groupedCrossReferences = useMemo(
    () =>
      Object.entries(
        crossReferences.reduce(
          (acc, ref) => {
            const brandName = ref.brandName?.trim()
            const articleNumber = ref.articleNumber?.trim()
            if (!brandName || !articleNumber) return acc

            if (!acc[brandName]) acc[brandName] = []
            const items = acc[brandName]
            const normalizedArticle = normalizeCrossRefToken(articleNumber)
            const existingIndex = items.findIndex(
              (item) =>
                normalizeCrossRefToken(item.articleNumber) === normalizedArticle
            )
            const providerCode = resolveProviderCodeFromBrand(brandName)

            if (existingIndex === -1) {
              items.push({
                articleNumber,
                supplierProductId: ref.supplierProductId ?? null,
                providerCode,
                partId: ref.partId ?? null
              })
              return acc
            }

            if (!items[existingIndex].supplierProductId && ref.supplierProductId) {
              items[existingIndex].supplierProductId = ref.supplierProductId
            }

            if (!items[existingIndex].providerCode && providerCode) {
              items[existingIndex].providerCode = providerCode
            }

            if (!items[existingIndex].partId && ref.partId) {
              items[existingIndex].partId = ref.partId
            }

            return acc
          },
          {} as Record<string, GroupedCrossReference[]>
        )
      ),
    [crossReferences]
  )

  // Filter groups based on selected make and model
  const filteredGroups = useMemo(() => {
    return groupedVehicles.filter((group) => {
      const matchesMake = !selectedMake || group.brandName === selectedMake
      const matchesModel = !selectedModel || group.modelName === selectedModel
      return matchesMake && matchesModel
    })
  }, [groupedVehicles, selectedMake, selectedModel])

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const toggleSubGroup = (key: string) => {
    setExpandedSubGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const resetFilters = () => {
    setSelectedMake('')
    setSelectedModel('')
  }

  const tabs: {
    key: TabKey
    label: string
    shortLabel: string
    icon: React.ReactNode
    count?: number
  }[] = [
    {
      key: 'technical',
      label: t('tabs.technical'),
      shortLabel: t('tabs.technicalShort'),
      icon: <Info className="w-4 h-4" />
    },
    {
      key: 'vehicles',
      label: t('tabs.vehicles'),
      shortLabel: t('tabs.vehiclesShort'),
      icon: <Car className="w-4 h-4" />,
      count: compatibleVehicles.length
    },
    {
      key: 'oem',
      label: t('tabs.oem'),
      shortLabel: t('tabs.oemShort'),
      icon: <FileText className="w-4 h-4" />,
      count: oens.length
    },
    {
      key: 'crossRefs',
      label: t('tabs.crossRefs'),
      shortLabel: t('tabs.crossRefsShort'),
      icon: <Shuffle className="w-4 h-4" />,
      count: crossReferences.length
    }
  ]

  return (
    <div className="bg-background rounded-xl shadow-sm border border-border overflow-hidden">
      {/* Tab Headers - Scrollable on mobile */}
      <div className="flex border-b border-border overflow-x-auto scrollbar-hide">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 md:gap-2 px-3 md:px-6 py-3 md:py-4 text-xs md:text-sm font-medium whitespace-nowrap transition-colors shrink-0 ${
              activeTab === tab.key
                ? 'text-primary border-b-2 border-primary bg-accent/50'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            {tab.icon}
            <span className="hidden md:inline">{tab.label}</span>
            <span className="md:hidden">{tab.shortLabel}</span>
            {tab.count !== undefined && tab.count > 0 && (
              <span
                className={`text-[10px] md:text-xs px-1.5 py-0.5 rounded-full ${
                  activeTab === tab.key
                    ? 'bg-accent text-primary'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="p-4 md:p-6">
        {activeTab === 'technical' && (
          <div className="space-y-4 md:space-y-6">
            {/* Properties Grid - Card based on mobile */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-x-8 md:gap-y-3">
              {Array.from(
                new Map(properties.map((p) => [p.key, p])).values()
              ).map((prop, idx) => (
                <div
                  key={idx}
                  className="flex justify-between items-center p-3 md:p-2 bg-muted md:bg-transparent rounded-lg md:rounded-none border border-border md:border-0 md:border-b md:border-border"
                >
                  <span className="text-xs md:text-sm text-muted-foreground">
                    {PRODUCT_SPEC_KEYS.has(prop.key)
                      ? tProductCard('specs.' + prop.key)
                      : prop.key}
                  </span>
                  <span className="text-xs md:text-sm font-medium text-foreground text-right">
                    {PRODUCT_SPEC_VALUE_KEYS.has(prop.value)
                      ? tProductCard('specValues.' + prop.value)
                      : prop.value}
                  </span>
                </div>
              ))}
            </div>

            {/* Info Notes */}
            {infos.length > 0 && (
              <div className="p-3 md:p-4 bg-warning/10 border border-warning/20 rounded-lg">
                <h4 className="font-medium text-warning mb-2 text-sm md:text-base">
                  {t('importantInfo')}
                </h4>
                <ul className="space-y-1">
                  {infos.map((info, idx) => (
                    <li key={idx} className="text-xs md:text-sm text-warning">
                      • {info}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {activeTab === 'vehicles' && (
          <div>
            {compatibleVehicles.length > 0 ? (
              <div className="space-y-4">
                {/* Filters */}
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center pb-4 border-b border-border">
                  <div className="flex gap-2 flex-1">
                    {/* Make Dropdown */}
                    <Select
                      value={selectedMake}
                      onValueChange={(value) => {
                        setSelectedMake(value === 'ALL' ? '' : value)
                        setSelectedModel('') // Reset model when make changes
                      }}
                    >
                      <SelectTrigger className="flex-1 sm:flex-none sm:w-40 bg-background">
                        <SelectValue placeholder={t('make')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">{t('all')}</SelectItem>
                        {uniqueMakes.map((make) => (
                          <SelectItem key={make} value={make}>
                            {make}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {/* Model Dropdown */}
                    <Select
                      value={selectedModel}
                      onValueChange={(value) =>
                        setSelectedModel(value === 'ALL' ? '' : value)
                      }
                      disabled={!selectedMake && uniqueModels.length === 0}
                    >
                      <SelectTrigger className="flex-1 sm:flex-none sm:w-40 bg-background">
                        <SelectValue placeholder={t('model')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">{t('all')}</SelectItem>
                        {uniqueModels.map((model) => (
                          <SelectItem key={model} value={model}>
                            {model}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Reset Button */}
                  <button
                    onClick={resetFilters}
                    className="flex items-center justify-center gap-1.5 h-10 px-4 text-sm font-medium text-primary hover:text-primary hover:bg-accent rounded-lg transition-colors"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>{t('reset')}</span>
                  </button>
                </div>

                {/* Vehicle Groups - Accordion */}
                <div className="space-y-1">
                  {filteredGroups.length > 0 ? (
                    filteredGroups.map((group) => (
                      <div
                        key={group.key}
                        className="border border-border rounded-lg overflow-hidden"
                      >
                        {/* Group Header - Toggle Button */}
                        <button
                          onClick={() => toggleGroup(group.key)}
                          className="w-full flex items-center justify-between p-3 md:p-4 bg-background hover:bg-muted transition-colors text-left"
                        >
                          <div className="flex items-center gap-2">
                            <ChevronRight
                              className={`w-4 h-4 text-muted-foreground transition-transform ${
                                expandedGroups.has(group.key) ? 'rotate-90' : ''
                              }`}
                            />
                            <span className="text-sm md:text-base font-semibold text-foreground">
                              {group.brandName} {group.modelName}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                            {group.subGroups.reduce(
                              (acc, sub) => acc + sub.types.length,
                              0
                            )}
                          </span>
                        </button>

                        {/* Group Content - Nested Accordion */}
                        {expandedGroups.has(group.key) && (
                          <div className="border-t border-border bg-muted">
                            {group.subGroups.map((subGroup) => (
                              <div
                                key={subGroup.key}
                                className="border-b border-border last:border-b-0"
                              >
                                {/* SubGroup Header */}
                                <button
                                  onClick={() => toggleSubGroup(subGroup.key)}
                                  className="w-full px-4 py-2 bg-muted border-b border-border text-sm font-medium text-foreground flex items-center gap-2 hover:bg-muted transition-colors text-left"
                                >
                                  <ChevronRight
                                    className={`w-3 h-3 text-muted-foreground transition-transform ${
                                      expandedSubGroups.has(subGroup.key)
                                        ? 'rotate-90'
                                        : ''
                                    }`}
                                  />
                                  {subGroup.vehicleName}
                                </button>

                                {/* Variants List */}
                                {expandedSubGroups.has(subGroup.key) && (
                                  <div>
                                    {subGroup.types.map((type, idx) => (
                                      <div
                                        key={type.id || idx}
                                        className="flex items-center justify-between p-3 md:px-4 md:py-3 border-b border-border last:border-b-0 pl-8"
                                      >
                                        <span className="text-xs md:text-sm text-foreground">
                                          {type.typeName}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                          {type.yearFrom || '-'} →{' '}
                                          {type.yearTo || t('present')}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="text-muted-foreground text-center py-8 text-sm">
                      {t('noVehiclesFound')}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-8 text-sm">
                {t('noVehicleInfo')}
              </p>
            )}
          </div>
        )}

        {activeTab === 'oem' && (
          <div>
            {oens.length > 0 ? (
              <div className="space-y-3 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-4 md:space-y-0">
                {/* Group OENs by brand */}
                {Object.entries(
                  oens.reduce((acc, oen) => {
                    if (!acc[oen.brand]) acc[oen.brand] = []
                    acc[oen.brand].push(oen.code)
                    return acc
                  }, {} as Record<string, string[]>)
                ).map(([brand, codes]) => (
                  <div
                    key={brand}
                    className="p-3 md:p-4 bg-muted rounded-md border border-border"
                  >
                    <h4 className="font-bold text-foreground mb-2 text-sm md:text-base">
                      {brand}
                    </h4>
                    <div className="flex flex-wrap gap-1.5 md:gap-2">
                      {codes.map((code, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-1 text-[10px] md:text-xs font-mono bg-background border border-border rounded text-foreground"
                        >
                          {code}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-8 text-sm">
                {t('noOemNumbers')}
              </p>
            )}
          </div>
        )}

        {activeTab === 'crossRefs' && (
          <div>
            {crossReferences.length > 0 ? (
              <div className="space-y-3 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-4 md:space-y-0">
                {/* Group cross references by brand */}
                {groupedCrossReferences.map(([brand, articles]) => (
                  <div
                    key={brand}
                    className="p-3 md:p-4 bg-muted rounded-md border border-border"
                  >
                    <h4 className="font-bold text-foreground mb-2 text-sm md:text-base flex items-center gap-1">
                      {brand}
                      <ChevronRight className="w-3 h-3 text-muted-foreground" />
                    </h4>
                    <div className="flex flex-wrap gap-1.5 md:gap-2">
                      {articles.map((article, idx) => {
                        if (article.partId) {
                          return (
                            <Link
                              key={idx}
                              href={`/part/${article.partId}`}
                              className="px-2 py-1 text-[10px] md:text-xs font-mono bg-success/10 border border-success/20 rounded text-success hover:bg-success/15 transition-colors"
                              title="Parça detayını aç"
                            >
                              {article.articleNumber}
                            </Link>
                          )
                        }

                        if (article.supplierProductId) {
                          return (
                            <Link
                              key={idx}
                              href={`/supplier-product/${article.supplierProductId}`}
                              className="px-2 py-1 text-[10px] md:text-xs font-mono bg-accent border border-border rounded text-primary hover:bg-accent transition-colors"
                              title="Tedarikçi ürün detayını aç"
                            >
                              {article.articleNumber}
                            </Link>
                          )
                        }

                        if (article.providerCode) {
                          return (
                            <Link
                              key={idx}
                              href={`/search?q=${encodeURIComponent(article.articleNumber)}`}
                              className="px-2 py-1 text-[10px] md:text-xs font-mono bg-accent border border-border rounded text-primary hover:bg-accent transition-colors"
                              title="Arama sonuçlarını aç"
                            >
                              {article.articleNumber}
                            </Link>
                          )
                        }

                        return (
                          <Link
                            key={idx}
                            href={`/search?q=${encodeURIComponent(article.articleNumber)}`}
                            className="px-2 py-1 text-[10px] md:text-xs font-mono bg-background border border-border rounded text-foreground hover:bg-muted cursor-pointer transition-colors"
                            title="Arama sonuçlarını aç"
                          >
                            {article.articleNumber}
                          </Link>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-8 text-sm">
                {t('noCrossRefs')}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
