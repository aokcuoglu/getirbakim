import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { useSyncExternalStore, useCallback } from 'react'
import { Vehicle } from '@/types'

interface GarageState {
  selectedVehicle: Vehicle | null
  vehicleHistory: Vehicle[]
}

interface GarageActions {
  setVehicle: (vehicle: Vehicle) => void
  clearVehicle: () => void
  addToHistory: (vehicle: Vehicle) => void
  setHistory: (vehicles: Vehicle[]) => void
}

type GarageStore = GarageState & GarageActions

const useGarageStore = create<GarageStore>()(
  persist(
    (set) => ({
      selectedVehicle: null,
      vehicleHistory: [],
      setVehicle: (vehicle) => set({ selectedVehicle: vehicle }),
      clearVehicle: () => set({ selectedVehicle: null }),
      addToHistory: (vehicle) =>
        set((state) => {
          const exists = state.vehicleHistory.some((v) => v.id === vehicle.id)
          if (exists) return state
          return { vehicleHistory: [vehicle, ...state.vehicleHistory] }
        }),
      setHistory: (vehicles) => set({ vehicleHistory: vehicles })
    }),
    {
      name: 'garage-storage', // unique name for localStorage key
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        selectedVehicle: state.selectedVehicle,
        vehicleHistory: state.vehicleHistory
      })
    }
  )
)

// Default empty state for SSR - prevents hydration mismatch
const emptyState: GarageStore = {
  selectedVehicle: null,
  vehicleHistory: [],
  setVehicle: () => {},
  clearVehicle: () => {},
  addToHistory: () => {},
  setHistory: () => {}
}

/**
 * Custom hook to safely access the garage store with hydration mismatch protection.
 * Uses useSyncExternalStore for proper SSR handling without causing re-renders.
 */
export function useGarage<T>(
  selector: (state: GarageStore) => T
): T {
  const subscribe = useCallback(
    (callback: () => void) => useGarageStore.subscribe(callback),
    []
  )

  const getSnapshot = useCallback(
    () => selector(useGarageStore.getState()),
    [selector]
  )

  // Return empty/default state during SSR to prevent hydration mismatch
  // This ensures consistent rendering between server and initial client render
  const getServerSnapshot = useCallback(
    () => selector(emptyState),
    [selector]
  )

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

// Export the raw store if direct access is needed (use with caution regarding hydration)
// or for usage in non-component contexts (e.g. event handlers)
export const getGarageStore = () => useGarageStore.getState()
export const garageStoreApi = useGarageStore
