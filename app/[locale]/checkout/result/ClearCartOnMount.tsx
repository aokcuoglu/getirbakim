'use client'

import { useEffect } from 'react'
import { useShop } from '@/components/ShopProvider'

export default function ClearCartOnMount() {
  const { clearCart } = useShop()

  useEffect(() => {
    clearCart()
  }, [clearCart])

  return null
}
