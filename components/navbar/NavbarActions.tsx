'use client'

import React from 'react'
import {
  User,
  LogOut,
  LayoutDashboard,
  ChevronDown,
  Car,
  Plus,
  ShoppingCart,
  PackageCheck
} from 'lucide-react'
import { Link, useRouter } from '@/lib/navigation'
import { useTranslations } from 'next-intl'
import { useShop } from '@/components/ShopProvider'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import { buildCatalogPath } from '@/lib/catalog-url'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { createClient } from '@/lib/supabase/client'

interface NavbarActionsProps {
  onGarageOpenChange?: (open: boolean) => void
  onUserMenuOpenChange?: (open: boolean) => void
  onLanguageOpenChange?: (open: boolean) => void
  closeAllDropdowns: () => void
  isGarageOpen?: boolean
  isUserMenuOpen?: boolean
  isLanguageOpen?: boolean
  onLoginClick?: () => void
  onMobileGarageClick?: () => void
}

export const NavbarActions: React.FC<NavbarActionsProps> = ({
  onGarageOpenChange,
  onUserMenuOpenChange,
  onLanguageOpenChange,
  closeAllDropdowns,
  isGarageOpen = false,
  isUserMenuOpen = false,
  isLanguageOpen = false,
  onLoginClick,
  onMobileGarageClick
}) => {
  const router = useRouter()
  const t = useTranslations('Navbar')

  const {
    cartItemCount,
    setIsCartOpen,
    selectedVehicle,
    user,
    setUser,
    vehicleHistory,
    selectFromHistory,
    clearSelectedVehicle
  } = useShop()

  const handleUserClick = () => {
    if (user) {
      if (!isUserMenuOpen) {
        closeAllDropdowns()
        onUserMenuOpenChange?.(true)
      } else {
        onUserMenuOpenChange?.(false)
      }
    } else {
      onLoginClick?.()
    }
  }

  const handleLogout = async () => {
    setUser(null)
    closeAllDropdowns()
    const supabase = createClient()
    const { error } = await supabase.auth.signOut()
    if (error) {
      console.error('Failed to sign out:', error)
    }
    router.refresh()
  }

  const handleScrollToSelector = () => {
    closeAllDropdowns()
    router.push('/') // Assuming onHomeClick does this
    // Scroll logic needs to be handled.
    // Maybe we just route to / and let the page handle scrolling or pass a query param.
    // The original code passed `onHomeClick` which scrolled.
    // I can stick to that or use a custom hook/event.
    setTimeout(() => {
      const element = document.getElementById('vehicle-selector')
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 100)
  }

  return (
    <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
      <div className="hidden md:block">
        <LanguageSwitcher
          isOpen={isLanguageOpen}
          onOpenChange={(open) => {
            if (open) closeAllDropdowns()
            onLanguageOpenChange?.(open)
          }}
        />
      </div>

      {/* My Profile - Hidden on Mobile */}
      <div className="relative hidden md:block">
        <button
          onClick={handleUserClick}
          className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded-lg group transition-colors"
        >
          <div className="w-8 h-8 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-500 group-hover:text-blue-600 transition-colors">
            <User size={18} strokeWidth={1.5} />
          </div>
          <div className="hidden lg:flex w-[104px] flex-col items-start">
            <span className="text-[11px] text-slate-400 font-medium leading-none mb-0.5">
              {t('account')}
            </span>
            <div className="flex w-full items-center gap-1">
              <span className="text-[13px] font-semibold text-slate-700 leading-none truncate">
                {user ? t('myProfile') : t('signIn')}
              </span>
              <ChevronDown size={12} className="text-slate-400" />
            </div>
          </div>
        </button>
        {/* User Dropdown */}
        {isUserMenuOpen && user && (
          <div className="absolute top-full right-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-slate-100 py-2 z-50 animate-in fade-in zoom-in-95 duration-200">
            <div className="px-4 py-3 border-b border-slate-50 mb-2">
              <p className="text-sm font-medium text-slate-900">{user.name}</p>
              <p className="text-xs text-slate-500 truncate">{user.email}</p>
            </div>
            {String(user.role || '').toUpperCase() === 'ADMIN' && (
              <Link
                href="/admin"
                className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                onClick={closeAllDropdowns}
              >
                <LayoutDashboard size={14} /> Admin Panel
              </Link>
            )}
            <Link
              href="/account?section=orders"
              className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
              onClick={closeAllDropdowns}
            >
              <PackageCheck size={14} /> My Orders
            </Link>
            <button
              onClick={handleLogout}
              className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
            >
              <LogOut size={14} /> Log Out
            </button>
          </div>
        )}
      </div>

      {/* My Garage */}
      <div className="relative">
        <button
          onClick={() => {
            // Mobile: use full-screen modal
            if (window.innerWidth < 768 && onMobileGarageClick) {
              onMobileGarageClick()
              return
            }
            // Desktop: use dropdown
            if (!isGarageOpen) {
              closeAllDropdowns()
              onGarageOpenChange?.(true)
            } else {
              onGarageOpenChange?.(false)
            }
          }}
          onBlur={() => setTimeout(() => onGarageOpenChange?.(false), 200)}
          className={`flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded-lg group transition-colors ${
            isGarageOpen ? 'bg-slate-50' : ''
          }`}
        >
          <div className="w-8 h-8 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-500 group-hover:text-amber-500 transition-colors relative">
            <Car size={18} strokeWidth={1.5} />
            {selectedVehicle && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-4 w-4 bg-amber-500 border-2 border-white items-center justify-center">
                  <span className="text-[8px] font-bold text-white">1</span>
                </span>
              </span>
            )}
          </div>
          <div className="hidden lg:flex w-[120px] flex-col items-start overflow-hidden">
            <span className="text-[11px] text-slate-400 font-medium leading-none mb-0.5">
              {t('garage')}
            </span>
            <div className="flex items-center gap-1 w-full">
              <span className="text-[13px] font-semibold text-slate-700 leading-none truncate w-full text-left">
                {selectedVehicle ? `${selectedVehicle.model}` : t('addVehicle')}
              </span>
              <ChevronDown size={12} className="text-slate-400 shrink-0" />
            </div>
          </div>
        </button>

        {/* Garage Panel */}
        {isGarageOpen && (
          <div
            className="absolute top-full right-0 mt-2 w-80 bg-white rounded-xl shadow-xl border border-slate-100 p-4 z-100 animate-in fade-in zoom-in-95 duration-200"
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-900">
                {t('garage')}
              </h3>
              <span className="text-xs text-slate-500">
                {vehicleHistory.length} {t('saved')}
              </span>
            </div>

            {/* Active Vehicle */}
            {selectedVehicle ? (
              <div
                className="p-3 bg-amber-50 border border-amber-100 rounded-lg mb-3 relative group cursor-pointer hover:bg-amber-100/50 transition-colors"
                onClick={() => {
                  const selectedVehicleUrlKey = (selectedVehicle as any)?.urlKey
                  if (selectedVehicleUrlKey) {
                    router.push(
                      buildCatalogPath({
                        categoryUrlKey: 'car-parts',
                        variantSlug: selectedVehicleUrlKey
                      })
                    )
                    closeAllDropdowns()
                  }
                }}
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded bg-white flex items-center justify-center text-amber-500 shadow-sm">
                    <Car size={20} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                        {t('active')}
                      </span>
                    </div>
                    <p className="font-bold text-slate-900 text-sm mt-1">
                      {selectedVehicle.year} {selectedVehicle.make}{' '}
                      {selectedVehicle.model}
                    </p>
                    <p className="text-xs text-slate-600">
                      {(selectedVehicle as any)?.fuel || '—'} • {selectedVehicle.engine}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleScrollToSelector()
                    }}
                    className="flex-1 text-xs bg-white border border-slate-200 text-slate-700 py-1.5 rounded hover:bg-slate-50 transition-colors font-medium"
                  >
                    {t('edit')}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      clearSelectedVehicle()
                    }}
                    className="flex-1 text-xs bg-white border border-slate-200 text-red-600 hover:text-red-700 py-1.5 rounded hover:bg-slate-50 transition-colors font-medium"
                  >
                    {t('cancel')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-6 bg-slate-50 rounded-lg border border-dashed border-slate-200 mb-3">
                <Car size={32} className="mx-auto text-slate-300 mb-2" />
                <p className="text-sm text-slate-500">{t('noActiveVehicle')}</p>
              </div>
            )}

            {/* Recent / Saved Controls */}
            <div className="max-h-48 overflow-y-auto space-y-1">
              {vehicleHistory
                .filter((v) => v.id !== selectedVehicle?.id)
                .map((vehicle) => (
                  <button
                    key={vehicle.id}
                    onClick={() => {
                      selectFromHistory(vehicle)
                      const historyVehicleUrlKey = (vehicle as any)?.urlKey
                      if (historyVehicleUrlKey) {
                        router.push(
                          buildCatalogPath({
                            categoryUrlKey: 'car-parts',
                            variantSlug: historyVehicleUrlKey
                          })
                        )
                      }
                      closeAllDropdowns()
                    }}
                    className="w-full flex items-center gap-3 p-2 hover:bg-slate-50 rounded-md text-left transition-colors"
                  >
                    <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center text-slate-400">
                      <span className="font-bold text-xs">
                        {vehicle.make.substring(0, 3).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1">
                      <p className="text-xs font-medium text-slate-700">
                        {vehicle.year} {vehicle.model}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {vehicle.engine}
                      </p>
                    </div>
                  </button>
                ))}
            </div>

            <div className="mt-3 pt-3 border-t border-slate-100">
              <button
                onClick={handleScrollToSelector}
                className="w-full py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors flex items-center justify-center gap-2"
              >
                <Plus size={14} /> {t('addNewVehicle')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Cart */}
      <NotificationBell showLabel />

      {/* Cart */}
      <button
        onClick={() => {
          closeAllDropdowns()
          setIsCartOpen(true)
        }}
        className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded-lg group transition-colors"
      >
        <div className="w-8 h-8 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-500 group-hover:text-emerald-600 transition-colors relative">
          <ShoppingCart size={18} strokeWidth={1.5} />
          {cartItemCount > 0 && (
            <span className="absolute -top-1 -right-1 h-5 w-5 bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-white">
              {cartItemCount}
            </span>
          )}
        </div>
        <div className="hidden lg:flex flex-col items-start">
          <span className="text-[11px] text-slate-400 font-medium leading-none mb-0.5">
            {t('cart')}
          </span>
          <span className="text-[13px] font-semibold text-slate-700 leading-none">
            {t('view')}
          </span>
        </div>
      </button>
    </div>
  )
}
