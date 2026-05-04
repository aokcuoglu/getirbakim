'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { useRouter } from '@/lib/navigation'
import { Search, ChevronDown } from 'lucide-react'
import { Dropdown } from './Dropdown'
import { MobileVehicleSelectorModal } from './MobileVehicleSelectorModal'
import {
  useVehicleData,
  type VehicleMake,
  type VehicleModel,
  type VehicleVariant
} from '@/lib/context/VehicleDataProvider'
import { useShop } from '../ShopProvider'
import { Vehicle } from '@/types'
import { Button } from '../ui/button'
import { buildCatalogPath } from '@/lib/catalog-url'

type OpenSlot = 'MAKE' | 'MODEL' | 'TYPE' | null

interface DropdownItem {
  id: string
  label: string
  [key: string]: any
}

const formatModelLabel = (model: VehicleModel) => {
  const dateFrom = model.dateFrom?.trim()
  const dateTo = model.dateTo?.trim()

  if (!dateFrom && !dateTo) return model.name

  const getYear = (value?: string | null) => {
    const match = value?.match(/\d{4}/)
    return match?.[0] || null
  }

  const yearFrom = getYear(dateFrom) || '?'
  const yearTo = getYear(dateTo) || 'Şuan'

  return `${model.name} (${yearFrom} - ${yearTo})`
}

const buildSelectedVehicle = (
  make: VehicleMake,
  model: VehicleModel,
  type: VehicleVariant
): Vehicle => ({
  id: type.id.toString(),
  make: make.name,
  model: model.name,
  year: type.yearFrom || new Date().getFullYear(),
  engine: type.name,
  fuel: type.fuelType || '',
  variant: type.name,
  urlKey: type.urlKey || undefined,
  vehicleTypeId: type.vehicleTypeId ?? type.id
})

export const VehicleSelector = () => {
  const router = useRouter()
  const { handleVehicleSelect } = useShop()
  const { isLoading, vehicleBrands, fetchVehicleModels, fetchVehicleTypes } =
    useVehicleData()

  // Selection State
  const [selectedMake, setSelectedMake] = useState<VehicleMake | null>(null)
  const [selectedModel, setSelectedModel] = useState<VehicleModel | null>(null)
  const [selectedType, setSelectedType] = useState<VehicleVariant | null>(null)

  // Data for dropdowns
  const [models, setModels] = useState<VehicleModel[]>([])
  const [types, setTypes] = useState<VehicleVariant[]>([])

  // Loading states
  const [modelsLoading, setModelsLoading] = useState(false)
  const [typesLoading, setTypesLoading] = useState(false)

  // Dropdown Open State
  const [openSlot, setOpenSlot] = useState<OpenSlot>(null)

  // Mobile modal state
  const [isMobileModalOpen, setIsMobileModalOpen] = useState(false)

  // Convert makes to dropdown format
  const makesList = useMemo<DropdownItem[]>(() => {
    return vehicleBrands.map((m) => ({
      id: m.id.toString(),
      label: m.name
    }))
  }, [vehicleBrands])

  // Convert models to dropdown format
  const modelsList = useMemo<DropdownItem[]>(() => {
    return models.map((m) => ({
      id: m.id.toString(),
      label: formatModelLabel(m)
    }))
  }, [models])

  // Convert types to dropdown format with grouping by fuel type
  const typesList = useMemo<DropdownItem[]>(() => {
    if (types.length === 0) return []

    // Group types by fuel type
    const grouped: Record<string, VehicleVariant[]> = {}
    types.forEach((t) => {
      const fuel = t.fuelType || 'Other'
      if (!grouped[fuel]) grouped[fuel] = []
      grouped[fuel].push(t)
    })

    const result: DropdownItem[] = []
    Object.keys(grouped)
      .sort()
      .forEach((fuel) => {
        // Add header for fuel type
        result.push({
          id: `header-${fuel}`,
          label: fuel,
          isHeader: true
        })

        // Add types for this fuel group
        grouped[fuel].forEach((v) => {
          const sublabel = v.kwPs ? `(${v.kwPs})` : undefined

          result.push({
            id: v.id.toString(),
            label: v.name,
            sublabel,
            payload: {
              yearFrom: v.yearFrom,
              yearTo: v.yearTo,
              ccm: v.ccm,
              kwPs: v.kwPs,
              urlKey: v.urlKey,
              fuelType: v.fuelType
            }
          })
        })
      })

    return result
  }, [types])

  // Fetch models when make changes
  useEffect(() => {
    if (selectedMake) {
      setModelsLoading(true)
      fetchVehicleModels(selectedMake.id)
        .then(setModels)
        .finally(() => setModelsLoading(false))
    } else {
      setModels([])
    }
  }, [selectedMake, fetchVehicleModels])

  // Fetch types when model changes
  useEffect(() => {
    if (selectedModel) {
      setTypesLoading(true)
      fetchVehicleTypes(selectedModel.id)
        .then(setTypes)
        .finally(() => setTypesLoading(false))
    } else {
      setTypes([])
    }
  }, [selectedModel, fetchVehicleTypes])

  // Labels
  const modelLabel = useMemo(() => {
    if (modelsLoading) return 'Loading...'
    if (selectedModel) return formatModelLabel(selectedModel)
    return 'MODEL'
  }, [selectedModel, modelsLoading])

  const typeLabel = useMemo(() => {
    if (typesLoading) return 'Loading...'
    if (selectedType) return selectedType.name
    return 'TYPE'
  }, [selectedType, typesLoading])

  // Handlers
  const handleMakeSelect = (item: DropdownItem) => {
    const make = vehicleBrands.find((m) => m.id.toString() === item.id)
    if (make && (!selectedMake || selectedMake.id !== make.id)) {
      setSelectedMake(make)
      // Reset downstream
      setSelectedModel(null)
      setSelectedType(null)
    }
    setOpenSlot('MODEL')
  }

  const handleModelSelect = (item: DropdownItem) => {
    const model = models.find((m) => m.id.toString() === item.id)
    if (model && (!selectedModel || selectedModel.id !== model.id)) {
      setSelectedModel(model)
      setSelectedType(null)
    }
    setOpenSlot('TYPE')
  }

  const handleTypeSelect = (item: DropdownItem) => {
    const type = types.find((v) => v.id.toString() === item.id)
    if (type) {
      console.log('[VehicleSelector] Type selected:', type)
      setSelectedType(type)
      setOpenSlot(null)

      // Immediately navigate when type is selected
      if (selectedMake && selectedModel) {
        handleVehicleSelect(
          buildSelectedVehicle(selectedMake, selectedModel, type)
        )

        console.log('[VehicleSelector] Navigating to urlKey:', type.urlKey)
        // Redirect to catalog shell with selected category+vehicle
        if (type.urlKey) {
          router.push(
            buildCatalogPath({
              categoryUrlKey: 'car-parts',
              variantSlug: type.urlKey
            })
          )
        } else {
          console.warn('[VehicleSelector] No urlKey found for type:', type)
        }
      }
    }
  }

  const handleSearch = () => {
    if (selectedMake && selectedModel && selectedType) {
      handleVehicleSelect(
        buildSelectedVehicle(selectedMake, selectedModel, selectedType)
      )

      console.log(
        '[VehicleSelector] Search triggered. urlKey:',
        selectedType.urlKey
      )
      if (selectedType.urlKey) {
        router.push(
          buildCatalogPath({
            categoryUrlKey: 'car-parts',
            variantSlug: selectedType.urlKey
          })
        )
      } else {
        router.push(
          buildCatalogPath({
            categoryUrlKey: 'car-parts'
          })
        )
      }
    }
  }

  if (isLoading) {
    return (
      <div className="w-full max-w-6xl mx-auto px-3 sm:px-4 z-40 relative font-sans">
        <div className="flex items-center justify-center h-[48px]">
          <div className="animate-pulse text-slate-400">
            Loading vehicles...
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-3 sm:px-4 z-40 relative font-sans mt-3 sm:mt-4">
      {/* MOBILE LAYOUT */}
      <div className="flex flex-col gap-3 items-center md:hidden">
        {/* License Plate Group - Türkiye */}
        <div className="flex items-center shadow-md rounded-md overflow-hidden h-[46px] w-full max-w-md">
          <div className="bg-[#1248b0] w-11 h-full flex flex-col items-center justify-center gap-0.5 z-10">
            <svg
              viewBox="0 0 24 24"
              className="w-5 h-5 text-white flex-shrink-0"
              fill="currentColor"
              aria-hidden
            >
              <path
                fillRule="evenodd"
                d="M12 2a10 10 0 0110 10 10 10 0 01-10 10 10 10 0 01-10-10 10 10 0 0110-10z M22.5 12a7.5 7.5 0 11-15 0 7.5 7.5 0 0115 0z"
              />
              <path d="M16 5.5l1 3.5 3.5.5-2.5 2 .5 3.5L16 13l-2.5 2 .5-3.5-2.5-2 3.5-.5 1-3.5z" />
            </svg>
            <span className="text-white font-bold text-[10px]">TR</span>
          </div>
          <div className="relative h-full bg-white flex-1 border-y border-r border-slate-200 flex items-center">
            <input
              type="text"
              placeholder="34 TC 036"
              className="w-full h-full px-3 text-slate-800 font-bold uppercase text-sm placeholder:text-slate-300 placeholder:font-normal focus:outline-none"
            />
          </div>
          <button className="h-full w-11 bg-[#0f75d8] hover:bg-[#0b68c4] text-white flex items-center justify-center transition-colors">
            <Search size={18} strokeWidth={2.5} />
          </button>
        </div>

        {/* Divider OR */}
        <div className="flex items-center gap-4 w-full max-w-md">
          <div className="flex-1 h-px bg-slate-400/30"></div>
          <span className="text-slate-400 text-xs font-bold tracking-wider">
            OR
          </span>
          <div className="flex-1 h-px bg-slate-400/30"></div>
        </div>

        {/* Single Select Vehicle Button */}
        <div className="w-full max-w-md">
          <Button
            variant="outline"
            onClick={() => setIsMobileModalOpen(true)}
            className="w-full flex items-center justify-between text-left h-11"
          >
            <span className="text-slate-800 font-medium">
              {selectedType
                ? `${selectedMake?.name} ${selectedModel?.name}`
                : 'Select vehicle'}
            </span>
            <ChevronDown size={20} className="text-slate-400" />
          </Button>
        </div>
      </div>

      {/* Mobile Vehicle Selector Modal */}
      <MobileVehicleSelectorModal
        isOpen={isMobileModalOpen}
        onClose={() => setIsMobileModalOpen(false)}
      />

      {/* DESKTOP LAYOUT */}
      <div className="hidden md:flex flex-row gap-2.5 items-center justify-center">
        {/* License Plate Group - Türkiye */}
        <div className="flex items-center shadow-md rounded-md overflow-hidden h-[46px]">
          <div className="bg-[#1248b0] w-10 h-full flex flex-col items-center justify-center gap-0.5 z-10">
            <svg
              viewBox="0 0 24 24"
              className="w-4 h-4 text-white flex-shrink-0"
              fill="currentColor"
              aria-hidden
            >
              <path
                fillRule="evenodd"
                d="M12 2a10 10 0 0110 10 10 10 0 01-10 10 10 10 0 01-10-10 10 10 0 0110-10z M22.5 12a7.5 7.5 0 11-15 0 7.5 7.5 0 0115 0z"
              />
              <path d="M16 5.5l1 3.5 3.5.5-2.5 2 .5 3.5L16 13l-2.5 2 .5-3.5-2.5-2 3.5-.5 1-3.5z" />
            </svg>
            <span className="text-white font-bold text-[10px]">TR</span>
          </div>
          <div className="relative h-full bg-white w-44 border-y border-r border-slate-200 flex items-center">
            <input
              type="text"
              placeholder="34 TC 036"
              className="w-full h-full px-3 text-slate-800 font-bold uppercase text-sm placeholder:text-slate-300 placeholder:font-normal focus:outline-none"
            />
          </div>
          <button className="h-full w-11 bg-[#0f75d8] hover:bg-[#0b68c4] text-white flex items-center justify-center transition-colors">
            <Search size={18} strokeWidth={2.5} />
          </button>
        </div>

        {/* Divider OR */}
        <div className="flex flex-col items-center gap-1 h-10 justify-center px-2">
          <div className="w-px h-3 bg-slate-400/40"></div>
          <span className="text-slate-400 text-[10px] font-bold tracking-wider">
            OR
          </span>
          <div className="w-px h-3 bg-slate-400/40"></div>
        </div>

        {/* Dropdowns Group */}
        <div className="flex flex-row gap-3 items-center">
          {/* 1. Manufacturer */}
          <div className="w-56 h-[46px]">
            <Dropdown
              label="MANUFACTURER"
              items={makesList}
              active={true}
              selectedItem={
                selectedMake
                  ? { id: selectedMake.id.toString(), label: selectedMake.name }
                  : null
              }
              onSelect={handleMakeSelect}
              height="h-full"
              isOpen={openSlot === 'MAKE'}
              onToggle={(open) => setOpenSlot(open ? 'MAKE' : null)}
            />
          </div>

          {/* 2. Model */}
          <div className="w-56 h-[46px] relative">
            <Dropdown
              label={modelLabel}
              items={modelsList}
              active={!!selectedMake && !modelsLoading}
              selectedItem={
                selectedModel
                  ? {
                      id: selectedModel.id.toString(),
                      label: formatModelLabel(selectedModel)
                    }
                  : null
              }
              onSelect={handleModelSelect}
              height="h-full"
              isOpen={openSlot === 'MODEL'}
              onToggle={(open) => setOpenSlot(open ? 'MODEL' : null)}
              headerTitle={selectedMake ? selectedMake.name : undefined}
            />
          </div>

          {/* 3. Type */}
          <div className="w-56 h-[46px] relative">
            <Dropdown
              label={typeLabel}
              items={typesList}
              active={!!selectedModel && !typesLoading}
              selectedItem={
                selectedType
                  ? {
                      id: selectedType.id.toString(),
                      label: selectedType.name
                    }
                  : null
              }
              onSelect={handleTypeSelect}
              height="h-full"
              isOpen={openSlot === 'TYPE'}
              onToggle={(open) => setOpenSlot(open ? 'TYPE' : null)}
              headerTitle={selectedModel ? selectedModel.name : undefined}
            />
          </div>

          {/* Search Button */}
          <button
            onClick={handleSearch}
            disabled={!selectedType}
            className="h-[46px] w-11 bg-[#0f75d8] hover:bg-[#0b68c4] text-white flex items-center justify-center rounded-md shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            <Search size={18} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  )
}
