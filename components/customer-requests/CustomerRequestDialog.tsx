'use client'

import { type ReactNode, useEffect, useMemo, useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { useShop } from '@/components/ShopProvider'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { createCustomerRequest } from '@/lib/actions/customer-requests'
import type {
  CreateCustomerRequestInput,
  CustomerRequestSource,
  CustomerRequestType
} from '@/lib/types/customer-requests'

interface ProductContext {
  partId?: number | null
  partName?: string | null
  brandName?: string | null
  categoryName?: string | null
}

interface CustomerRequestDialogProps {
  requestType: CustomerRequestType
  source: CustomerRequestSource
  trigger: ReactNode
  product?: ProductContext
  searchQuery?: string
  title?: string
  description?: string
  submitLabel?: string
  successMessage?: string
}

function formatVehicleLabel(vehicle: ReturnType<typeof useShop>['selectedVehicle']) {
  if (!vehicle) return ''

  return [
    vehicle.year,
    vehicle.make,
    vehicle.model,
    vehicle.engine,
    vehicle.fuel
  ]
    .filter(Boolean)
    .join(' ')
}

export function CustomerRequestDialog({
  requestType,
  source,
  trigger,
  product,
  searchQuery,
  title,
  description,
  submitLabel,
  successMessage
}: CustomerRequestDialogProps) {
  const t = useTranslations('CustomerRequests')
  const locale = useLocale()
  const pathname = usePathname()
  const { selectedVehicle, user } = useShop()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const [requestedSkuOrOem, setRequestedSkuOrOem] = useState('')
  const [vehicleDescription, setVehicleDescription] = useState('')

  const resolvedTitle = useMemo(() => {
    if (title) return title
    return requestType === 'PRICE_REQUEST'
      ? t('priceRequest.title')
      : t('missingProduct.title')
  }, [requestType, t, title])

  const resolvedDescription = useMemo(() => {
    if (description) return description
    return requestType === 'PRICE_REQUEST'
      ? t('priceRequest.description')
      : t('missingProduct.description')
  }, [description, requestType, t])

  const resolvedSubmitLabel = useMemo(() => {
    if (submitLabel) return submitLabel
    return requestType === 'PRICE_REQUEST'
      ? t('priceRequest.submit')
      : t('missingProduct.submit')
  }, [requestType, submitLabel, t])

  useEffect(() => {
    if (!open) return

    setName(user?.name ?? '')
    setEmail(user?.email ?? '')
    setPhone('')
    setMessage('')
    setRequestedSkuOrOem(searchQuery ?? product?.partName ?? '')
    setVehicleDescription(formatVehicleLabel(selectedVehicle))
  }, [open, product?.partName, searchQuery, selectedVehicle, user?.email, user?.name])

  const handleSubmit = () => {
    const noteParts =
      requestType === 'MISSING_PRODUCT'
        ? [message.trim(), vehicleDescription.trim() ? `Araç: ${vehicleDescription.trim()}` : '']
            .filter(Boolean)
            .join('\n')
        : message.trim()

    const payload: CreateCustomerRequestInput = {
      requestType,
      source,
      name,
      email,
      phone,
      message: noteParts,
      pageUrl: pathname,
      locale,
      vehicle: selectedVehicle,
      partId: product?.partId ?? undefined,
      partNameSnapshot: product?.partName ?? undefined,
      brandNameSnapshot: product?.brandName ?? undefined,
      categoryNameSnapshot: product?.categoryName ?? undefined,
      searchQuery,
      requestedSkuOrOem:
        requestType === 'MISSING_PRODUCT'
          ? requestedSkuOrOem
          : undefined
    }

    startTransition(async () => {
      const result = await createCustomerRequest(payload)
      if (!result.success) {
        toast.error(result.message)
        return
      }

      toast.success(
        successMessage ||
          (requestType === 'PRICE_REQUEST'
            ? t('priceRequest.success')
            : t('missingProduct.success'))
      )
      setOpen(false)
    })
  }

  const triggerLabel =
    requestType === 'PRICE_REQUEST'
      ? t('priceRequest.productLabel')
      : t('missingProduct.searchLabel')

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-xl border-border bg-background p-0">
        <div className="border-b border-border bg-muted px-6 py-5">
          <DialogHeader>
            <DialogTitle className="text-xl text-foreground">
              {resolvedTitle}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {resolvedDescription}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-4 px-6 py-5">
          {product?.partName && (
            <div className="rounded-md border border-border bg-muted px-4 py-3 text-sm text-foreground">
              <p className="font-semibold text-foreground">{triggerLabel}</p>
              <p className="mt-1">
                {[product.brandName, product.partName].filter(Boolean).join(' ')}
              </p>
            </div>
          )}

          {requestType === 'MISSING_PRODUCT' && searchQuery && (
            <div className="rounded-md border border-warning/20 bg-warning/10 px-4 py-3 text-sm text-amber-900">
              <p className="font-semibold">{t('missingProduct.lastSearch')}</p>
              <p className="mt-1 break-words">{searchQuery}</p>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                {t('fields.name')}
              </label>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('fields.namePlaceholder')}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                {t('fields.email')}
              </label>
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={t('fields.emailPlaceholder')}
              />
            </div>
          </div>

          <div
            className={`grid gap-4 ${
              requestType === 'MISSING_PRODUCT' ? 'md:grid-cols-2' : ''
            }`}
          >
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                {t('fields.phone')}
              </label>
              <Input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder={t('fields.phonePlaceholder')}
              />
            </div>

            {requestType === 'MISSING_PRODUCT' && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  {t('fields.searchedPart')}
                </label>
                <Input
                  value={requestedSkuOrOem}
                  onChange={(event) => setRequestedSkuOrOem(event.target.value)}
                  placeholder={t('fields.searchedPartPlaceholder')}
                />
              </div>
            )}
          </div>

          {requestType === 'MISSING_PRODUCT' && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                {t('fields.vehicle')}
              </label>
              <Input
                value={vehicleDescription}
                onChange={(event) => setVehicleDescription(event.target.value)}
                placeholder={t('fields.vehiclePlaceholder')}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              {requestType === 'MISSING_PRODUCT'
                ? t('missingProduct.noteLabel')
                : t('fields.message')}
            </label>
            <Textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={4}
              placeholder={
                requestType === 'MISSING_PRODUCT'
                  ? t('missingProduct.notePlaceholder')
                  : t('fields.messagePlaceholder')
              }
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              {t('cancel')}
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={isPending}>
              {isPending ? t('submitting') : resolvedSubmitLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
