'use client'

import React from 'react'
import { X, ChevronRight, Car } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useShop } from '@/components/ShopProvider'
import { useRouter } from '@/lib/navigation'
import { buildCatalogPath } from '@/lib/catalog-url'

interface MobileGarageModalProps {
  isOpen: boolean
  onClose: () => void
  onSelectVehicle: () => void
}

export const MobileGarageModal: React.FC<MobileGarageModalProps> = ({
  isOpen,
  onClose,
  onSelectVehicle
}) => {
  const t = useTranslations('Navbar')
  const router = useRouter()
  const {
    selectedVehicle,
    vehicleHistory,
    selectFromHistory,
    clearSelectedVehicle
  } = useShop()
  const selectedVehicleWithMeta = selectedVehicle as
    | ((typeof selectedVehicle & {
        urlKey?: string
        fuel?: string
        variant?: string
      })
    | null)

  if (!isOpen) return null

  const handleSelectFromHistory = (vehicle: (typeof vehicleHistory)[0]) => {
    selectFromHistory(vehicle)
    const vehicleWithMeta = vehicle as typeof vehicle & {
      urlKey?: string
      fuel?: string
      variant?: string
    }

    if (vehicleWithMeta.urlKey) {
      router.push(
        buildCatalogPath({
          categoryUrlKey: 'car-parts',
          variantSlug: vehicleWithMeta.urlKey
        })
      )
    }
    onClose()
  }

  const handleSelectVehicleClick = () => {
    onClose()
    onSelectVehicle()
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-[100] md:hidden animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-x-0 bottom-0 top-0 bg-white z-[101] md:hidden animate-in slide-in-from-bottom duration-300">
        {/* Header */}
        <div className="flex items-center justify-center px-4 h-14 border-b border-slate-100 relative">
          <span className="text-base font-semibold text-slate-900">
            {t('garage')}
          </span>
          <button
            onClick={onClose}
            className="absolute right-4 p-2 text-slate-500 hover:text-slate-700"
          >
            <X size={20} strokeWidth={1.5} />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto h-[calc(100vh-56px)] p-4">
          {/* My Vehicle Section */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-slate-500 mb-3">
              {t('myVehicle') || 'My vehicle'}
            </h3>

            {selectedVehicleWithMeta ? (
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-lg bg-amber-100 flex items-center justify-center text-amber-600">
                    <Car size={24} />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-slate-900">
                      {selectedVehicleWithMeta.make} {selectedVehicleWithMeta.model}
                    </p>
                    <p className="text-sm text-slate-500">
                      {selectedVehicleWithMeta.fuel} • {selectedVehicleWithMeta.engine}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => {
                      if (selectedVehicleWithMeta.urlKey) {
                        router.push(
                          buildCatalogPath({
                            categoryUrlKey: 'car-parts',
                            variantSlug: selectedVehicleWithMeta.urlKey
                          })
                        )
                      }
                      onClose()
                    }}
                    className="flex-1 py-2 bg-[#0088CC] text-white text-sm font-medium rounded-lg hover:bg-[#0077b3] transition-colors"
                  >
                    {t('viewParts') || 'View parts'}
                  </button>
                  <button
                    onClick={() => clearSelectedVehicle()}
                    className="px-4 py-2 bg-white border border-slate-200 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 transition-colors"
                  >
                    {t('remove') || 'Remove'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={handleSelectVehicleClick}
                className="w-full py-3 bg-[#0088CC] text-white text-sm font-medium rounded-lg hover:bg-[#0077b3] transition-colors"
              >
                {t('selectYourVehicle') || 'Select your vehicle'}
              </button>
            )}
          </div>

          {/* My History Section */}
          {vehicleHistory.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-slate-500 mb-3">
                {t('myHistory') || 'My history'}
              </h3>
              <div className="border-t border-slate-100">
                {vehicleHistory
                  .filter((v) => v.id !== selectedVehicle?.id)
                  .map((vehicle) => {
                    const vehicleWithMeta = vehicle as typeof vehicle & {
                      fuel?: string
                      variant?: string
                    }

                    return (
                    <button
                      key={vehicle.id}
                      onClick={() => handleSelectFromHistory(vehicle)}
                      className="w-full flex items-center gap-3 py-4 border-b border-slate-100 hover:bg-slate-50 transition-colors text-left"
                    >
                      <div className="flex-1">
                        <p className="font-semibold text-slate-900 text-sm">
                          {vehicle.make} {vehicle.model} ({vehicle.year})
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {vehicleWithMeta.fuel} {vehicle.engine}
                        </p>
                        {vehicleWithMeta.variant && (
                          <p className="text-xs text-slate-400 mt-0.5">
                            {vehicleWithMeta.variant}
                          </p>
                        )}
                      </div>
                      <div className="w-9 h-9 rounded-lg bg-[#0088CC] flex items-center justify-center text-white shrink-0">
                        <ChevronRight size={18} />
                      </div>
                    </button>
                    )
                  })}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
