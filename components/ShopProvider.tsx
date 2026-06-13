'use client'

import { useGarage } from '@/hooks/use-garage'

import React, {
  createContext,
  useContext,
  useState,
  useMemo,
  useEffect,
  useRef
} from 'react'
import { Product, Vehicle, CartItem, FilterState, Category } from '@/types'
import { PRODUCTS, VEHICLES } from '@/constants'
import { usePathname } from '@/lib/navigation'
import { useLocale } from 'next-intl'
import { warmCategoryCaches } from '@/lib/client/category-cache'
import { resolveVehicleTypeId } from '@/lib/utils/vehicleSlug'
import { toast } from 'sonner'
import type { CartReconcileEvent } from '@/lib/notifications/types'

type CartReconcileResult = {
  success: boolean
  items: CartItem[]
  events: CartReconcileEvent[]
}

export interface ShopContextType {
  cart: CartItem[]
  addToCart: (product: Omit<CartItem, 'quantity'>, quantity?: number) => void
  reconcileCart: (
    reason?: 'hydration' | 'cart_open' | 'visibility' | 'checkout_submit'
  ) => Promise<CartReconcileResult>
  clearCart: () => void
  removeFromCart: (id: string) => void
  updateQty: (id: string, delta: number) => void
  isCartOpen: boolean
  setIsCartOpen: (open: boolean) => void
  selectedVehicle: Vehicle | null
  handleVehicleSelect: (v: Vehicle) => void
  filters: FilterState
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>
  filteredProducts: Product[]
  handleCategorySelect: (c: Category) => void
  handleMakeSelect: (make: string) => void
  handleBrandSelect: (brand: string) => void
  cartItemCount: number
  // New Props for MyGarage
  user: any | null
  setUser: (user: any | null) => void
  refetchUser: () => Promise<void>
  vehicleHistory: Vehicle[]
  addToHistory: (vehicle: Vehicle) => void
  selectFromHistory: (vehicle: Vehicle) => void
  clearSelectedVehicle: () => void
}

const ShopContext = createContext<ShopContextType | undefined>(undefined)

const CART_STORAGE_KEY = 'shop-cart:v2'
const CART_STORAGE_VERSION = 2
const CART_RECONCILE_STALE_MS = 60_000

type PersistedCartPayload = {
  version: number
  items: Array<{
    partId?: number
    id?: string
    name: string
    brand: string
    price: number
    quantity: number
    imageUrl: string
  }>
}

import { getUserVehicles, addUserVehicle } from '@/lib/actions/user-vehicles'
import { getFilteredProducts } from '@/lib/actions/products'

function normalizePartId(raw: { partId?: number; id?: string }): number | null {
  if (typeof raw.partId === 'number' && Number.isInteger(raw.partId) && raw.partId > 0) {
    return raw.partId
  }
  const parsedFromId = Number(raw.id)
  if (Number.isInteger(parsedFromId) && parsedFromId > 0) return parsedFromId
  return null
}

function normalizeCartItem(
  input: PersistedCartPayload['items'][number] | CartItem
): CartItem | null {
  const partId = normalizePartId(input)
  if (!partId) return null

  const quantity = Math.max(1, Math.floor(Number(input.quantity) || 0))
  const price = Number(input.price)
  if (!Number.isFinite(price) || price <= 0) return null

  return {
    partId,
    id: String(partId),
    name: input.name,
    brand: input.brand,
    price,
    quantity,
    imageUrl: input.imageUrl || '/logo.png'
  }
}

function normalizeCartArray(items: Array<PersistedCartPayload['items'][number] | CartItem>): CartItem[] {
  const merged = new Map<number, CartItem>()

  for (const item of items) {
    const normalized = normalizeCartItem(item)
    if (!normalized) continue

    const existing = merged.get(normalized.partId)
    if (existing) {
      merged.set(normalized.partId, {
        ...existing,
        quantity: existing.quantity + normalized.quantity
      })
      continue
    }

    merged.set(normalized.partId, normalized)
  }

  return Array.from(merged.values())
}

function hasCartChanged(current: CartItem[], next: CartItem[]): boolean {
  if (current.length !== next.length) return true
  for (let i = 0; i < current.length; i += 1) {
    const a = current[i]
    const b = next[i]
    if (
      a.partId !== b.partId ||
      a.quantity !== b.quantity ||
      a.price !== b.price ||
      a.name !== b.name ||
      a.brand !== b.brand ||
      a.imageUrl !== b.imageUrl
    ) {
      return true
    }
  }
  return false
}

function announceCartEvents(events: CartReconcileEvent[]): void {
  if (events.length === 0) return
  if (events.length === 1) {
    toast.info(events[0].message)
    return
  }
  toast.info(`${events.length} sepet kalemi güncellendi.`)
}

export function ShopProvider({
  children,
  user: initialUser
}: {
  children: React.ReactNode
  user?: any
}) {
  // Use Garage Store for Vehicle State - now always returns values (no undefined)
  const pathname = usePathname()
  const locale = useLocale()
  const isAdminRoute = /^\/(?:[a-z]{2}\/)?admin(?:\/|$)/.test(pathname)

  const selectedVehicle = useGarage((state) => state.selectedVehicle)
  const vehicleHistory = useGarage((state) => state.vehicleHistory)
  const setVehicle = useGarage((state) => state.setVehicle)
  const clearVehicle = useGarage((state) => state.clearVehicle)
  const addToHistoryStore = useGarage((state) => state.addToHistory)
  const setHistory = useGarage((state) => state.setHistory)

  // Refs to prevent duplicate effect runs (Strict Mode safe)
  const authInitializedRef = useRef(false)
  const historyFetchedRef = useRef<string | null>(null)
  const categoryWarmupRef = useRef<Set<string>>(new Set())
  const cartHydratedRef = useRef(false)
  const isPersistingCartRef = useRef(false)
  const cartRef = useRef<CartItem[]>([])
  const lastCartReconcileAtRef = useRef(0)

  // Cart & Filter State (remains local)
  const [cart, setCart] = useState<CartItem[]>([])
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [filters, setFilters] = useState<FilterState>({
    category: 'All',
    brand: 'All',
    vehicleMake: 'All',
    minPrice: 0,
    maxPrice: 200
  })

  // MyGarage User State - initialize with server-provided user to avoid hydration mismatch
  const [user, setUser] = useState<any>(initialUser ?? null)

  const refetchUser = async () => {
    try {
      const res = await fetch('/api/me', { cache: 'no-store' })
      const json = (await res.json().catch(() => null)) as { user: any | null } | null
      setUser(json?.user ?? null)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    cartRef.current = cart
  }, [cart])

  useEffect(() => {
    if (isAdminRoute || cartHydratedRef.current) return

    try {
      const raw = window.localStorage.getItem(CART_STORAGE_KEY)
      if (!raw) {
        cartHydratedRef.current = true
        return
      }

      const parsed = JSON.parse(raw) as PersistedCartPayload
      if (!parsed || parsed.version !== CART_STORAGE_VERSION || !Array.isArray(parsed.items)) {
        cartHydratedRef.current = true
        return
      }

      const hydratedItems = normalizeCartArray(parsed.items)
      cartRef.current = hydratedItems
      setCart(hydratedItems)
    } catch {
      // ignore
    } finally {
      cartHydratedRef.current = true
    }
  }, [isAdminRoute])

  useEffect(() => {
    if (isAdminRoute || !cartHydratedRef.current) return
    if (isPersistingCartRef.current) return

    try {
      isPersistingCartRef.current = true
      const payload: PersistedCartPayload = {
        version: CART_STORAGE_VERSION,
        items: cart.map((item) => ({
          partId: item.partId,
          id: item.id,
          name: item.name,
          brand: item.brand,
          price: item.price,
          quantity: item.quantity,
          imageUrl: item.imageUrl
        }))
      }
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(payload))
    } catch {
      // ignore
    } finally {
      isPersistingCartRef.current = false
    }
  }, [cart, isAdminRoute])

  // Auth State Management
  // Fetches user session on mount via /api/me
  useEffect(() => {
    if (authInitializedRef.current) return
    authInitializedRef.current = true

    let mounted = true

    void (async () => {
      try {
        const res = await fetch('/api/me', { cache: 'no-store' })
        const json = (await res.json().catch(() => null)) as
          | { user: any | null }
          | null
        if (mounted) {
          setUser((prev: any) => {
            const next = json?.user ?? null
            if (prev?.id && next?.id && prev.id === next.id) return prev
            if (!prev && !next) return prev
            return next
          })
        }
      } catch {
        // ignore
      }
    })()

    return () => {
      mounted = false
      authInitializedRef.current = false
    }
  }, [])

  // Sync History from DB when user logs in
  // Uses ref to prevent duplicate fetches for same user
  useEffect(() => {
    if (isAdminRoute) return
    if (!user?.id) return

    // Skip if we already fetched for this user
    if (historyFetchedRef.current === user.id) return
    historyFetchedRef.current = user.id

    getUserVehicles(user.id).then((dbVehicles) => {
      const vehicles = dbVehicles.map((v) => v.vehicle)
      setHistory(vehicles)
    })
  }, [isAdminRoute, user?.id, setHistory])

  // Sync new additions to DB
  const addToHistory = async (vehicle: Vehicle) => {
    // Add to store (which handles localStorage)
    addToHistoryStore(vehicle)

    if (user) {
      // Save to DB
      await addUserVehicle(user.id, vehicle)
    }
  }

  const selectFromHistory = (vehicle: Vehicle) => {
    setVehicle(vehicle)
    setFilters((prev) => ({ ...prev, vehicleMake: 'All' }))
  }

  const handleVehicleSelect = (v: Vehicle) => {
    setVehicle(v)
    addToHistory(v)
    setFilters((prev) => ({ ...prev, vehicleMake: 'All' }))
  }

  // --- Cart & Product Logic (Unchanged) ---
  const cartItemCount = useMemo(
    () => cart.reduce((acc, item) => acc + item.quantity, 0),
    [cart]
  )
  const [serverProducts, setServerProducts] = useState<Product[]>([])
  const [isFetching, setIsFetching] = useState(false)
  const selectedVehicleTypeId = resolveVehicleTypeId(selectedVehicle)

  const pathSegments = pathname.split('/').filter(Boolean)
  const isHomeRoute =
    pathSegments.length === 1 &&
    (pathSegments[0] === 'tr' || pathSegments[0] === 'en')

  useEffect(() => {
    if (isAdminRoute || !isHomeRoute) return

    const cacheKey = `${locale}:${selectedVehicleTypeId ?? 'all'}`
    if (categoryWarmupRef.current.has(cacheKey)) return
    categoryWarmupRef.current.add(cacheKey)

    warmCategoryCaches(locale, selectedVehicleTypeId).catch((error) => {
      console.error('Category warmup failed', error)
      categoryWarmupRef.current.delete(cacheKey)
    })
  }, [
    isAdminRoute,
    isHomeRoute,
    locale,
    pathname,
    selectedVehicleTypeId
  ])

  useEffect(() => {
    if (filters.categoryId) {
      setIsFetching(true)
      getFilteredProducts(String(filters.categoryId))
        .then((products) => {
          setServerProducts(products)
        })
        .finally(() => {
          setIsFetching(false)
        })
    } else {
      setServerProducts([])
    }
  }, [filters.categoryId])

  const filteredProducts = useMemo(() => {
    if (filters.categoryId) return serverProducts
    return PRODUCTS.filter((p) => {
      if (filters.category !== 'All' && p.category !== filters.category)
        return false
      if (filters.brand !== 'All' && p.brand !== filters.brand) return false
      if (p.price > filters.maxPrice) return false
      if (selectedVehicle) {
        if (!p.compatibleVehicles.includes(selectedVehicle.id)) return false
      } else if (filters.vehicleMake !== 'All') {
        const compatibleVehicleIds = VEHICLES.filter(
          (v) => v.make === filters.vehicleMake
        ).map((v) => v.id)
        if (
          !p.compatibleVehicles.some((id) => compatibleVehicleIds.includes(id))
        )
          return false
      }
      return true
    })
  }, [filters, selectedVehicle, serverProducts])

  const reconcileCart = async (
    reason: 'hydration' | 'cart_open' | 'visibility' | 'checkout_submit' = 'cart_open'
  ): Promise<CartReconcileResult> => {
    const currentCart = cartRef.current

    if (currentCart.length === 0) {
      lastCartReconcileAtRef.current = Date.now()
      return { success: true, items: [], events: [] }
    }

    try {
      const response = await fetch('/api/cart/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: currentCart.map((item) => ({
            partId: item.partId,
            quantity: item.quantity,
            knownPrice: item.price
          }))
        })
      })

      const json = (await response.json().catch(() => null)) as
        | {
            items?: CartItem[]
            events?: CartReconcileEvent[]
          }
        | null

      if (!response.ok || !json?.items || !Array.isArray(json.items)) {
        return { success: false, items: currentCart, events: [] }
      }

      const normalizedItems = normalizeCartArray(json.items)
      const events = Array.isArray(json.events) ? json.events : []
      if (hasCartChanged(currentCart, normalizedItems)) {
        setCart(normalizedItems)
        cartRef.current = normalizedItems
      }

      if (events.length > 0) {
        announceCartEvents(events)
      }

      lastCartReconcileAtRef.current = Date.now()
      return {
        success: true,
        items: normalizedItems,
        events
      }
    } catch {
      return { success: false, items: currentCart, events: [] }
    } finally {
      if (reason === 'checkout_submit') {
        lastCartReconcileAtRef.current = Date.now()
      }
    }
  }

  useEffect(() => {
    if (isAdminRoute) return
    if (!cartHydratedRef.current) return
    if (cartRef.current.length === 0) return

    void reconcileCart('hydration')
  }, [isAdminRoute])

  useEffect(() => {
    if (!isCartOpen) return
    if (isAdminRoute) return
    if (!cartHydratedRef.current) return

    void reconcileCart('cart_open')
  }, [isCartOpen, isAdminRoute])

  useEffect(() => {
    if (isAdminRoute) return

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      if (!cartHydratedRef.current) return
      if (cartRef.current.length === 0) return

      const now = Date.now()
      if (now - lastCartReconcileAtRef.current < CART_RECONCILE_STALE_MS) return
      void reconcileCart('visibility')
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [isAdminRoute])

  const addToCart = (
    product: Omit<CartItem, 'quantity'>,
    quantity: number = 1
  ) => {
    const normalizedQuantity = Number.isFinite(quantity)
      ? Math.max(1, Math.floor(quantity))
      : 1
    const partId = normalizePartId(product)
    if (!partId) return

    setCart((prev) => {
      const existing = prev.find((item) => item.partId === partId)
      if (existing) {
        return prev.map((item) =>
          item.partId === partId
            ? { ...item, quantity: item.quantity + normalizedQuantity }
            : item
        )
      }
      return [
        ...prev,
        {
          ...product,
          partId,
          id: String(partId),
          quantity: normalizedQuantity
        }
      ]
    })
    setIsCartOpen(true)
  }

  const removeFromCart = (id: string) =>
    setCart((prev) => prev.filter((item) => item.id !== id))

  const clearCart = () => setCart([])

  const updateQty = (id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) =>
          item.id === id
            ? { ...item, quantity: Math.max(0, item.quantity + delta) }
            : item
        )
        .filter((item) => item.quantity > 0)
    )
  }

  const handleCategorySelect = (category: Category) =>
    setFilters((prev) => ({ ...prev, category }))

  const handleMakeSelect = (make: string) => {
    clearVehicle()
    setFilters((prev) => ({
      ...prev,
      vehicleMake: make,
      brand: 'All',
      category: 'All'
    }))
  }

  const handleBrandSelect = (brand: string) =>
    setFilters((prev) => ({ ...prev, brand: brand }))

  return (
    <ShopContext.Provider
      value={{
        cart,
        addToCart,
        reconcileCart,
        clearCart,
        removeFromCart,
        updateQty,
        isCartOpen,
        setIsCartOpen,
        selectedVehicle,
        handleVehicleSelect,
        filters,
        setFilters,
        filteredProducts,
        handleCategorySelect,
        handleMakeSelect,
        handleBrandSelect,
        cartItemCount,
        user: user || null,
        setUser,
        refetchUser,
        vehicleHistory,
        addToHistory,
        selectFromHistory,
        clearSelectedVehicle: clearVehicle
      }}
    >
      {children}
    </ShopContext.Provider>
  )
}

export const useShop = () => {
  const context = useContext(ShopContext)
  if (!context) throw new Error('useShop must be used within a ShopProvider')
  return context
}
