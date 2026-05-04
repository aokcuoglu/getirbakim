'use client'

import type { OrderView } from '@/lib/orders/service'
import { OrderStatusBadge } from '@/components/orders/OrderStatusBadge'
import { formatCheckoutPaymentTitle } from '@/lib/payments/format'
import { useLocale, useTranslations } from 'next-intl'

export function OrderDetailView({ order }: { order: OrderView }) {
  const t = useTranslations('OrderDetail')
  const locale = useLocale()
  const numberLocale = locale === 'tr' ? 'tr-TR' : 'en-US'

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <InfoCard label={t('orderNumber')} value={order.orderNumber} />
        <InfoCard label={t('orderStatus')} value={order.status} badge />
        <InfoCard label={t('paymentStatus')} value={order.paymentStatus} badge />
        <InfoCard
          label={t('total')}
          value={order.totalAmount.toLocaleString(numberLocale, {
            style: 'currency',
            currency: order.currency
          })}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">{t('orderItems')}</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{item.productName}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {t('partId')}: {item.partId} | {t('articleLinkId')}: {item.articleLinkId}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {item.quantity} x{' '}
                    {item.price.toLocaleString(numberLocale, {
                      style: 'currency',
                      currency: order.currency
                    })}
                  </p>
                </div>
                <p className="text-sm font-semibold text-slate-900">
                  {item.lineTotal.toLocaleString(numberLocale, {
                    style: 'currency',
                    currency: order.currency
                  })}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <InfoPanel
            title={t('delivery')}
            rows={[
              [t('customer'), order.customerName],
              [t('email'), order.customerEmail || '-'],
              [t('phone'), order.guestPhone || order.shippingAddress?.phone || '-'],
              [t('shipping'), order.shippingMethod || '-'],
              [
                t('address'),
                order.shippingAddress
                  ? [
                      order.shippingAddress.line1,
                      order.shippingAddress.line2,
                      order.shippingAddress.city,
                      order.shippingAddress.postalCode,
                      order.shippingAddress.country
                    ]
                      .filter(Boolean)
                      .join(', ')
                  : '-'
              ]
            ]}
          />

          <InfoPanel
            title={t('payment')}
            rows={[
              [t('method'), formatCheckoutPaymentTitle(order.paymentMethod)],
              [t('paymentStatus'), order.paymentStatus],
              [
                t('subtotal'),
                order.subtotalAmount.toLocaleString(numberLocale, {
                  style: 'currency',
                  currency: order.currency
                })
              ],
              [
                t('shipping'),
                order.shippingFee.toLocaleString(numberLocale, {
                  style: 'currency',
                  currency: order.currency
                })
              ]
            ]}
          />

          {order.latestPayment && (
            <InfoPanel
              title={t('latestPaymentRecord')}
              rows={[
                [t('provider'), order.latestPayment.provider],
                [t('status'), order.latestPayment.status],
                [t('reference'), order.latestPayment.providerPaymentId || '-'],
                [
                  t('paymentTime'),
                  order.latestPayment.paidAt
                    ? new Date(order.latestPayment.paidAt).toLocaleString(numberLocale)
                    : '-'
                ],
                [t('error'), order.latestPayment.failureReason || '-']
              ]}
            />
          )}
        </section>
      </div>
    </div>
  )
}

function InfoCard({
  label,
  value,
  badge = false
}: {
  label: string
  value: string
  badge?: boolean
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-2">
        {badge ? (
          <OrderStatusBadge status={value} />
        ) : (
          <p className="text-base font-semibold text-slate-900">{value}</p>
        )}
      </div>
    </div>
  )
}

function InfoPanel({
  title,
  rows
}: {
  title: string
  rows: Array<[string, string]>
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 py-4">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      </div>
      <div className="space-y-3 px-5 py-4">
        {rows.map(([label, value]) => (
          <div key={label}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {label}
            </p>
            <p className="mt-1 text-sm text-slate-700">{value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
