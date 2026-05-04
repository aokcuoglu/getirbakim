'use client'

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback
} from 'react'
import { usePathname } from '@/lib/navigation'
import {
  getVehicleBrandsAction,
  getVehicleModelsAction,
  getVehicleTypesAction
} from '@/app/actions/vehicle-selector'

// Types for vehicle data
export interface VehicleMake {
  id: number
  name: string
}

export interface VehicleModel {
  id: number
  name: string
  dateFrom?: string | null
  dateTo?: string | null
}

export interface VehicleVariant {
  id: number
  name: string
  yearFrom?: number | null
  yearTo?: number | null
  ccm?: string | null
  kwPs?: string | null
  engineCode?: string | null
  urlKey?: string | null
  vehicleTypeId?: number | null
  tecdocId?: number | null
  fuelType?: string | null
}

interface VehicleDataContextType {
  isLoading: boolean
  error: string | null
  // New 3-level hierarchy
  vehicleBrands: VehicleMake[]
  fetchVehicleModels: (brandId: number) => Promise<VehicleModel[]>
  fetchVehicleTypes: (modelId: number) => Promise<VehicleVariant[]>
}

const VehicleDataContext = createContext<VehicleDataContextType | undefined>(
  undefined
)

export function VehicleDataProvider({
  children
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isAdminRoute = /^\/(?:[a-z]{2}\/)?admin(?:\/|$)/.test(pathname)

  const [vehicleBrands, setVehicleBrands] = useState<VehicleMake[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load vehicle brands on mount
  useEffect(() => {
    if (isAdminRoute) {
      setIsLoading(false)
      return
    }

    let cancelled = false

    setIsLoading(true)
    console.log('[VehicleDataProvider] Fetching vehicle brands...')
    getVehicleBrandsAction()
      .then((result) => {
        if (cancelled) return
        console.log('[VehicleDataProvider] Result:', result)
        if (result.success && result.data) {
          console.log(
            '[VehicleDataProvider] Loaded brands:',
            result.data.length
          )
          setVehicleBrands(result.data as VehicleMake[])
        } else {
          console.error('[VehicleDataProvider] Failed:', result.error)
          setError(result.error || 'Failed to load vehicle brands')
        }
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Failed to load vehicle brands:', err)
        setError(err.message)
      })
      .finally(() => {
        if (cancelled) return
        setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [isAdminRoute])

  const fetchVehicleModels = useCallback(
    async (brandId: number): Promise<VehicleModel[]> => {
      try {
        const result = await getVehicleModelsAction(brandId)
        if (result.success && result.data) {
          return result.data as VehicleModel[]
        }
        return []
      } catch (err) {
        console.error('Failed to load vehicle models:', err)
        return []
      }
    },
    []
  )

  const fetchVehicleTypes = useCallback(
    async (modelId: number): Promise<VehicleVariant[]> => {
      try {
        const result = await getVehicleTypesAction(modelId)
        if (result.success && result.data) {
          return result.data as VehicleVariant[]
        }
        return []
      } catch (err) {
        console.error('Failed to load vehicle types:', err)
        return []
      }
    },
    []
  )

  return (
    <VehicleDataContext.Provider
      value={{
        isLoading,
        error,
        vehicleBrands,
        fetchVehicleModels,
        fetchVehicleTypes
      }}
    >
      {children}
    </VehicleDataContext.Provider>
  )
}

export function useVehicleData() {
  const context = useContext(VehicleDataContext)
  if (!context) {
    throw new Error('useVehicleData must be used within a VehicleDataProvider')
  }
  return context
}
