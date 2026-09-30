'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { listPartnerOrdersForOperator } from '@/lib/partner/order-service'
import type { getPartnerOrderOperationsStats } from '@/lib/partner/webhook-dispatcher'
import type { PartnerOperatorAction } from '@/lib/partner/operator-contract'

type Data = Awaited<ReturnType<typeof listPartnerOrdersForOperator>> & { stats: Awaited<ReturnType<typeof getPartnerOrderOperationsStats>> }
type Order = Data['orders'][number]

const labels: Record<PartnerOperatorAction, string> = {
  CONFIRM: 'Onayla', REJECT: 'Reddet', ACCEPT_CANCELLATION: 'İptali kabul et',
  DECLINE_CANCELLATION: 'İptali reddet', SHIP: 'Sevk edildi', COMPLETE: 'Tamamla'
}

function actionsFor(order: Order): PartnerOperatorAction[] {
  if (order.status === 'REQUESTED' && new Date(order.bindingPrice.expiresAt).getTime() > Date.now()) return ['CONFIRM', 'REJECT']
  if (order.status === 'CONFIRMED' && order.cancellationRequested) return ['ACCEPT_CANCELLATION', 'DECLINE_CANCELLATION']
  if (order.status === 'CONFIRMED') return ['SHIP']
  if (order.status === 'SHIPPED') return ['COMPLETE']
  return []
}

export function PartnerOrdersClient({ initialData }: { initialData: Data }) {
  const [data, setData] = useState(initialData)
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    const response = await fetch('/api/admin/partner-orders', { cache: 'no-store' })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error?.message ?? 'Kuyruk güncellenemedi.')
    setData(body)
  }

  async function act(order: Order, action: PartnerOperatorAction) {
    setBusy(order.id)
    setError(null)
    try {
      const response = await fetch(`/api/admin/partner-orders/${order.id}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedVersion: order.version, action, reason: reasons[order.id]?.trim() || null })
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error?.message ?? 'İşlem başarısız.')
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'İşlem başarısız.')
      await refresh().catch(() => {})
    } finally {
      setBusy(null)
    }
  }

  return <div className="space-y-6">
    <div className="grid gap-3 sm:grid-cols-4 xl:grid-cols-7">
      {Object.entries(data.stats).map(([key, value]) => <div key={key} className="rounded-lg border bg-card p-3 text-sm">
        <div className="text-muted-foreground">{({ pendingDelivery: 'Bekleyen webhook', overdueDelivery: 'Geciken webhook', deadLettered: 'Başarısız webhook', pendingRequest: 'Bekleyen talep', overdueReservation: 'Süresi dolan talep', cancellationRequested: 'İptal talebi', completedCommitted: 'Tamamlanmış stok hold' } as Record<string, string>)[key] ?? key}</div>
        <div className="text-2xl font-semibold">{value}</div>
      </div>)}
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <Button variant="outline" size="sm" onClick={() => refresh().catch((cause) => setError(String(cause)))}>Yenile</Button>
    <div className="space-y-3">
      {data.orders.length === 0 && <p className="text-muted-foreground">Partner siparişi yok.</p>}
      {data.orders.map((order) => <section key={order.id} className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap justify-between gap-2 text-sm">
          <div><strong>{order.partnerId}</strong> · {order.id} · <strong>{order.status}</strong> · v{order.version}{order.cancellationRequested ? ' · İptal talebi var' : ''}</div>
          <div>{new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(order.bindingPrice.grossKurus / 100)}</div>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{order.productName} ({order.partNo}) · {order.supplierName} · Son onay: {new Date(order.bindingPrice.expiresAt).toLocaleString('tr-TR')} · Rezervasyon: {order.reservationStatus ?? '—'} · Kalem: {order.items.map(item => `${item.selectedOfferId} × ${item.quantity}`).join(', ')}</p>
        {actionsFor(order).length > 0 && <div className="mt-3 space-y-2">
          <Textarea value={reasons[order.id] ?? ''} onChange={(event) => setReasons({ ...reasons, [order.id]: event.target.value })} placeholder="İşlem gerekçesi zorunlu" aria-label={`${order.id} işlem gerekçesi`} />
          <div className="flex flex-wrap gap-2">{actionsFor(order).map(action => <Button key={action} size="sm" variant={action === 'REJECT' || action === 'ACCEPT_CANCELLATION' ? 'destructive' : 'outline'} disabled={busy === order.id} onClick={() => act(order, action)}>{labels[action]}</Button>)}</div>
        </div>}
      </section>)}
    </div>
    <div className="rounded-lg border bg-card p-4 text-sm">
      <h2 className="font-semibold">Son operatör işlemleri</h2>
      <ul className="mt-2 space-y-1">{data.actions.map(action => <li key={action.id}>{new Date(action.createdAt).toLocaleString('tr-TR')} · {action.actorId} · {action.action} · {action.orderId} · {action.fromStatus} → {action.toStatus}{action.reason ? ` · ${action.reason}` : ''}</li>)}</ul>
    </div>
  </div>
}
