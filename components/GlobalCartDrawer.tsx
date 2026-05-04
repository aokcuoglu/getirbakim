'use client'

import { useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import CartDrawer from '@/components/CartDrawer'
import { useShop } from '@/components/ShopProvider'

export function GlobalCartDrawer() {
  const locale = useLocale()
  const router = useRouter()
  const { cart, removeFromCart, updateQty, isCartOpen, setIsCartOpen } =
    useShop()

  return (
    <CartDrawer
      isOpen={isCartOpen}
      onClose={() => setIsCartOpen(false)}
      items={cart}
      onRemove={removeFromCart}
      onUpdateQty={updateQty}
      onCheckout={() => {
        setIsCartOpen(false)
        router.push(`/${locale}/checkout`)
      }}
    />
  )
}
