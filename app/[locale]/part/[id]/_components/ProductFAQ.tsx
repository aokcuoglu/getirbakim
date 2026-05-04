'use client'

import { type FormEvent, useEffect, useState, useTransition } from 'react'
import { useLocale } from 'next-intl'
import { usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useTranslations } from 'next-intl'
import { useShop } from '@/components/ShopProvider'
import { createCustomerRequest } from '@/lib/actions/customer-requests'

interface ProductFAQProps {
  partId: number
  productName: string
  brandName: string
  categoryName: string
}

export function ProductFAQ({
  partId,
  productName,
  brandName,
  categoryName
}: ProductFAQProps) {
  const t = useTranslations('Part.faq')
  const locale = useLocale()
  const pathname = usePathname()
  const { selectedVehicle, user } = useShop()
  const [isPending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    setName(user?.name ?? '')
    setEmail(user?.email ?? '')
  }, [user?.email, user?.name])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    startTransition(async () => {
      const result = await createCustomerRequest({
        requestType: 'PRODUCT_QUESTION',
        source: 'PRODUCT_FAQ_FORM',
        name,
        email,
        message,
        pageUrl: pathname,
        locale,
        vehicle: selectedVehicle,
        partId,
        partNameSnapshot: productName,
        brandNameSnapshot: brandName,
        categoryNameSnapshot: categoryName
      })

      if (!result.success) {
        toast.error(result.message)
        return
      }

      toast.success(t('success'))
      setMessage('')
    })
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-12">
      {/* Left Column - Text Info */}
      <div className="flex flex-col justify-center">
        <p className="text-lg md:text-xl font-bold text-slate-900 mb-4 leading-tight">
          {t('title')}
          <br />
          <span className="text-slate-900">{productName}?</span>
        </p>
        <p className="text-slate-600 text-sm md:text-base leading-relaxed">
          {t('description')}
        </p>
      </div>

      {/* Right Column - Contact Form */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 md:p-8 shadow-sm">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Input
                type="text"
                placeholder={t('namePlaceholder')}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Input
                type="email"
                placeholder={t('emailPlaceholder')}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-1">
            <Textarea
              placeholder={t('commentPlaceholder')}
              rows={4}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              required
            />
          </div>

          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? t('submitting') : t('submit')}
          </Button>
        </form>
      </div>
    </div>
  )
}
