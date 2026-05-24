'use client'

import React, { useState, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Search, ChevronRight, ChevronLeft } from 'lucide-react'
import { useRouter } from '@/lib/navigation'
import {
  useVehicleData,
  type VehicleMake,
  type VehicleModel,
  type VehicleVariant
} from '@/lib/context/VehicleDataProvider'
import { useShop } from '@/components/ShopProvider'
import { Vehicle } from '@/types'
import { useTranslations } from 'next-intl'
import { buildCatalogPath } from '@/lib/catalog-url'

interface MobileVehicleSelectorModalProps {
  isOpen: boolean
  onClose: () => void
}

// Popular makes to show at the top
const POPULAR_MAKES = [
  'AUDI',
  'BMW',
  'FORD',
  'MERCEDES-BENZ',
  'PEUGEOT',
  'RENAULT',
  'SKODA',
  'TOYOTA',
  'VOLVO',
  'VW'
]

type Step = 'MAKE' | 'MODEL' | 'TYPE'

export const MobileVehicleSelectorModal: React.FC<
  MobileVehicleSelectorModalProps
> = ({ isOpen, onClose }) => {
  const router = useRouter()
  const { handleVehicleSelect } = useShop()
  const t = useTranslations('VehicleSelector')
  const {
    isLoading: isGlobalLoading,
    vehicleBrands,
    fetchVehicleModels,
    fetchVehicleTypes
  } = useVehicleData()

  // Current step
  const [step, setStep] = useState<Step>('MAKE')
  const [searchQuery, setSearchQuery] = useState('')

  // Selected values
  const [selectedMake, setSelectedMake] = useState<VehicleMake | null>(null)
  const [selectedModel, setSelectedModel] = useState<VehicleModel | null>(null)

  // Lists
  const [models, setModels] = useState<VehicleModel[]>([])
  const [types, setTypes] = useState<VehicleVariant[]>([])

  // Loading states
  const [loading, setLoading] = useState(false)

  // Filter and sort makes
  const { popularMakes, allMakes } = useMemo(() => {
    const filtered = searchQuery
      ? vehicleBrands.filter((m) =>
          m.name.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : vehicleBrands

    const popular = filtered.filter((m) =>
      POPULAR_MAKES.includes(m.name.toUpperCase())
    )
    const all = [...filtered].sort((a, b) => a.name.localeCompare(b.name))

    return { popularMakes: popular, allMakes: all }
  }, [vehicleBrands, searchQuery])

  // Filter current list based on search
  const filteredList = useMemo(() => {
    const query = searchQuery.toLowerCase()
    switch (step) {
      case 'MODEL':
        return query
          ? models.filter((m) => m.name.toLowerCase().includes(query))
          : models
      case 'TYPE': {
        const queryResult = query
          ? types.filter((v) => v.name.toLowerCase().includes(query))
          : types

        if (queryResult.length === 0) return []

        // Group by fuel type
        const grouped: Record<string, VehicleVariant[]> = {}
        queryResult.forEach((t) => {
          const fuel = t.fuelType || 'Other'
          if (!grouped[fuel]) grouped[fuel] = []
          grouped[fuel].push(t)
        })

        const result: any[] = []
        Object.keys(grouped)
          .sort()
          .forEach((fuel) => {
            result.push({
              id: `header-${fuel}`,
              name: fuel,
              isHeader: true
            })
            grouped[fuel].forEach((v) => result.push(v))
          })
        return result
      }
      default:
        return []
    }
  }, [step, searchQuery, models, types])

  const handleMakeSelect = async (make: VehicleMake) => {
    setSelectedMake(make)
    setLoading(true)
    setSearchQuery('')
    try {
      const modelsList = await fetchVehicleModels(make.id)
      setModels(modelsList)
      setStep('MODEL')
    } finally {
      setLoading(false)
    }
  }

  const handleModelSelect = async (model: VehicleModel) => {
    setSelectedModel(model)
    setLoading(true)
    setSearchQuery('')
    try {
      const typesList = await fetchVehicleTypes(model.id)
      setTypes(typesList)
      setStep('TYPE')
    } finally {
      setLoading(false)
    }
  }

  const handleTypeSelect = (type: VehicleVariant) => {
    if (selectedMake && selectedModel) {
      const v: Vehicle = {
        id: type.id.toString(),
        make: selectedMake.name,
        model: selectedModel.name,
        year: type.yearFrom || new Date().getFullYear(),
        engine: type.name,
        fuel: type.fuelType || '',
        variant: type.name,
        urlKey: type.urlKey || undefined,
        vehicleTypeId: type.vehicleTypeId ?? type.id
      }
      handleVehicleSelect(v)

      if (type.urlKey) {
        router.push(
          buildCatalogPath({
            categoryUrlKey: 'car-parts',
            variantSlug: type.urlKey
          })
        )
      }
      handleClose()
    }
  }

  const handleBack = () => {
    setSearchQuery('')
    switch (step) {
      case 'MODEL':
        setStep('MAKE')
        setSelectedMake(null)
        break
      case 'TYPE':
        setStep('MODEL')
        setSelectedModel(null)
        break
    }
  }

  const handleClose = () => {
    // Reset state
    setStep('MAKE')
    setSearchQuery('')
    setSelectedMake(null)
    setSelectedModel(null)
    setModels([])
    setTypes([])
    onClose()
  }

  const getStepTitle = () => {
    switch (step) {
      case 'MAKE':
        return t('selectVehicle')
      case 'MODEL':
        return selectedMake?.name || t('selectModel')
      case 'TYPE':
        return selectedModel?.name || t('selectType')
    }
  }

  // Portal mounting
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

  if (!isOpen || !mounted) return null

  const modalContent = (
    <div className="fixed inset-0 z-9999 bg-background md:hidden animate-in fade-in duration-200 flex flex-col">
      {/* Header with background image */}
      <div className="relative bg-primary bg-[url('https://fbhvayopjuixbyddftbk.supabase.co/storage/v1/object/public/category-images/partfinder-bg.webp')] bg-cover bg-center">
        <div className="absolute inset-0 bg-primary/60" />
        <div className="relative z-10 flex items-center justify-between px-4 py-4">
          {step !== 'MAKE' ? (
            <button
              onClick={handleBack}
              className="p-2 -ml-2 text-primary-foreground hover:bg-primary-foreground/10 rounded-full transition-colors"
            >
              <ChevronLeft size={24} />
            </button>
          ) : (
            <div className="w-10" />
          )}
          <h2 className="text-xl font-bold text-primary-foreground">{getStepTitle()}</h2>
          <button
            onClick={handleClose}
            className="p-2 -mr-2 bg-primary-foreground/10 rounded-full text-primary-foreground hover:bg-primary-foreground/20 transition-colors"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* License Plate Input (only on first step) */}
      {step === 'MAKE' && (
        <div className="px-4 py-4 border-b border-border">
          <div className="flex items-center shadow-sm rounded-lg overflow-hidden h-[44px]">
            <div className="bg-destructive w-12 h-full flex flex-col items-center justify-center gap-0.5">
              <svg
                viewBox="0 0 24 24"
                className="w-4 h-4 text-destructive-foreground shrink-0"
                fill="currentColor"
                aria-hidden
              >
                <path
                  fillRule="evenodd"
                  d="M12 2a10 10 0 0110 10 10 10 0 01-10 10 10 10 0 01-10-10 10 10 0 0110-10z M22.5 12a7.5 7.5 0 11-15 0 7.5 7.5 0 0115 0z"
                />
                <path d="M16 5.5l1 3.5 3.5.5-2.5 2 .5 3.5L16 13l-2.5 2 .5-3.5-2.5-2 3.5-.5 1-3.5z" />
              </svg>
              <span className="text-destructive-foreground font-bold text-[10px]">TR</span>
            </div>
            <input
              type="text"
              placeholder="AB 1234"
              className="flex-1 h-full px-3 text-foreground font-bold uppercase placeholder:text-muted-foreground/70 placeholder:font-normal focus:outline-none border border-l-0 border-border"
            />
            <button className="h-full w-12 bg-primary hover:bg-primary/90 text-primary-foreground flex items-center justify-center transition-colors">
              <Search size={18} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      )}

      {/* Search Input */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center bg-muted rounded-md border border-border px-3 h-[44px]">
          <input
            type="text"
            placeholder={t('search')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <Search size={18} className="text-muted-foreground" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading || isGlobalLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            {t('loading')}
          </div>
        ) : step === 'MAKE' ? (
          <>
            {/* Popular Makes */}
            {popularMakes.length > 0 && !searchQuery && (
              <div className="px-4 py-3">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">
                  {t('popularMakes')}
                </h3>
                <div className="divide-y divide-border">
                  {popularMakes.map((make) => (
                    <button
                      key={make.id}
                      onClick={() => handleMakeSelect(make)}
                      className="w-full flex items-center justify-between py-3 hover:bg-muted transition-colors"
                    >
                      <span className="font-semibold text-foreground text-sm uppercase">
                        {make.name}
                      </span>
                      <ChevronRight size={18} className="text-muted-foreground" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* All Makes */}
            <div className="px-4 py-3 border-t border-border">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">
                {t('allMakes')}
              </h3>
              <div className="divide-y divide-border">
                {allMakes.map((make) => (
                  <button
                    key={make.id}
                    onClick={() => handleMakeSelect(make)}
                    className="w-full flex items-center justify-between py-3 hover:bg-muted transition-colors"
                  >
                    <span className="font-semibold text-foreground text-sm uppercase">
                      {make.name}
                    </span>
                    <ChevronRight size={18} className="text-muted-foreground" />
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          /* Other steps - Models, Types */
          <div className="px-4 py-3">
            <div className="divide-y divide-border">
              {(filteredList as any[]).map((item) =>
                item.isHeader ? (
                  <div
                    key={item.id}
                    className="bg-muted px-4 py-2 text-[10px] font-bold text-primary uppercase tracking-wider sticky top-0 z-10"
                  >
                    {item.name}
                  </div>
                ) : (
                  <button
                    key={item.id}
                    onClick={() => {
                      switch (step) {
                        case 'MODEL':
                          handleModelSelect(item as VehicleModel)
                          break
                        case 'TYPE':
                          handleTypeSelect(item as VehicleVariant)
                          break
                      }
                    }}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted transition-colors text-left border-b border-border last:border-0"
                  >
                    <div className="flex flex-col">
                      <span className="font-semibold text-foreground text-sm">
                        {item.name}
                      </span>
                      {step === 'TYPE' && (item as VehicleVariant).kwPs && (
                        <span className="text-xs text-muted-foreground">
                          {(item as VehicleVariant).kwPs}
                        </span>
                      )}
                    </div>
                    <ChevronRight size={18} className="text-muted-foreground" />
                  </button>
                )
              )}
              {filteredList.length === 0 && (
                <div className="py-8 text-center text-muted-foreground text-sm">
                  {t('noResults')}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
