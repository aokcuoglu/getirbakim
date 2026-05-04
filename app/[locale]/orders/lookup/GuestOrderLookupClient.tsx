'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { OrderDetailView } from '@/components/orders/OrderDetailView'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { OrderView } from '@/lib/orders/service'
import { useTranslations } from 'next-intl'

export function GuestOrderLookupClient() {
  const t = useTranslations('GuestOrderLookup')
  const [orderNumber, setOrderNumber] = useState('')
  const [email, setEmail] = useState('')
  const [order, setOrder] = useState<OrderView | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleLookup = () => {
    startTransition(async () => {
      const response = await fetch('/api/orders/guest-lookup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          orderNumber: orderNumber.trim(),
          email: email.trim()
        })
      })

      const json = (await response.json().catch(() => null)) as
        | { order?: OrderView; error?: { message?: string } }
        | null

      if (!response.ok || !json?.order) {
        setOrder(null)
        toast.error(json?.error?.message || t('orderNotFound'))
        return
      }

      setOrder(json.order)
    })
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
          <Input
            value={orderNumber}
            onChange={(event) => setOrderNumber(event.target.value)}
            placeholder={t('orderNumberPlaceholder')}
          />
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t('emailPlaceholder')}
          />
          <Button
            onClick={handleLookup}
            disabled={isPending || !orderNumber.trim() || !email.trim()}
          >
            {isPending ? t('searching') : t('findOrder')}
          </Button>
        </div>
      </div>

      {order && <OrderDetailView order={order} />}
    </div>
  )
}
