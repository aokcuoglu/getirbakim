'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useLocale } from 'next-intl'
import { ArrowLeft, CreditCard, ShieldCheck, Truck } from 'lucide-react'
import { useShop } from '@/components/ShopProvider'
import { useRouter } from 'next/navigation'
import { createCheckoutOrder } from '@/lib/actions/checkout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SHIPPING_FEE_BY_METHOD } from '@/lib/orders/types'

const emptyAddress = {
  fullName: '',
  phone: '',
  line1: '',
  line2: '',
  city: '',
  postalCode: '',
  country: 'Turkey'
}

const emptyCard = {
  holderName: '',
  number: '',
  cvv: '',
  expireMonth: '',
  expireYear: '',
  installmentCount: 1
}

function digitsOnly(value: string, maxLength?: number): string {
  const digits = value.replace(/\D/g, '')
  return maxLength ? digits.slice(0, maxLength) : digits
}

function formatCardNumber(value: string): string {
  return value
    .replace(/\D/g, '')
    .slice(0, 19)
    .replace(/(.{4})/g, '$1 ')
    .trim()
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export default function CheckoutPageClient() {
  const locale = useLocale()
  const router = useRouter()
  const { cart, user, reconcileCart } = useShop()
  const [contactEmail, setContactEmail] = useState(user?.email || '')
  const [address, setAddress] = useState(emptyAddress)
  const [shippingMethod, setShippingMethod] = useState<'STANDARD' | 'EXPRESS'>(
    'STANDARD'
  )
  const [paymentMethod, setPaymentMethod] = useState<'TAMI' | 'CASH_ON_DELIVERY'>('TAMI')
  const [paymentCard, setPaymentCard] = useState(emptyCard)
  const [note, setNote] = useState('')
  const [acceptedLegalTerms, setAcceptedLegalTerms] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (user?.email) {
      setContactEmail(user.email)
    }
  }, [user?.email])

  const subtotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [cart]
  )

  const shippingFee = SHIPPING_FEE_BY_METHOD[shippingMethod]
  const total = subtotal + shippingFee
  const hasRequiredCardDetails =
    paymentMethod !== 'TAMI' ||
    (paymentCard.holderName.trim().length >= 2 &&
      paymentCard.number.length >= 13 &&
      paymentCard.cvv.length >= 3 &&
      paymentCard.expireMonth.length >= 1 &&
      paymentCard.expireYear.length === 4)

  const canSubmit =
    cart.length > 0 &&
    (Boolean(user?.id) || contactEmail.trim().length > 0) &&
    address.fullName.trim().length > 0 &&
    address.phone.trim().length > 0 &&
    address.line1.trim().length > 0 &&
    address.city.trim().length > 0 &&
    address.postalCode.trim().length > 0 &&
    address.country.trim().length > 0 &&
    hasRequiredCardDetails

  const validateBeforeSubmit = (): string | null => {
    if (cart.length === 0) {
      return 'Sepetiniz bos gorunuyor.'
    }

    if (!user?.id && !contactEmail.trim()) {
      return 'Misafir alisverisi icin e-posta adresi gerekli.'
    }

    if (!user?.id && !isValidEmail(contactEmail)) {
      return 'Lutfen gecerli bir e-posta adresi girin.'
    }

    if (!address.fullName.trim()) {
      return 'Ad soyad alani gerekli.'
    }

    if (!address.phone.trim()) {
      return 'Telefon alani gerekli.'
    }

    if (!address.line1.trim()) {
      return 'Adres satiri gerekli.'
    }

    if (!address.city.trim()) {
      return 'Sehir alani gerekli.'
    }

    if (!address.postalCode.trim()) {
      return 'Posta kodu alani gerekli.'
    }

    if (!address.country.trim()) {
      return 'Ulke alani gerekli.'
    }

    if (paymentMethod === 'TAMI') {
      if (!paymentCard.holderName.trim()) {
        return 'Kart uzerindeki ad soyad gerekli.'
      }

      if (paymentCard.number.length < 13) {
        return 'Kart numarasi eksik veya hatali.'
      }

      if (paymentCard.cvv.length < 3) {
        return 'CVV alani eksik veya hatali.'
      }

      const month = Number(paymentCard.expireMonth)
      if (!Number.isInteger(month) || month < 1 || month > 12) {
        return 'Son kullanma ayi 1 ile 12 arasinda olmali.'
      }

      if (!/^\d{4}$/.test(paymentCard.expireYear)) {
        return 'Son kullanma yilini 4 haneli girin. Ornek: 2028'
      }
    }

    return null
  }

  const handleSubmit = () => {
    setError(null)
    const validationError = validateBeforeSubmit()
    if (validationError) {
      setError(validationError)
      return
    }
    if (!acceptedLegalTerms) {
      setError(
        'Siparisi tamamlamak icin Mesafeli Satis, On Bilgilendirme ve Gizlilik metinlerini onaylamalisiniz.'
      )
      return
    }
    if (paymentMethod === 'TAMI' && !hasRequiredCardDetails) {
      setError('Kart bilgilerini eksiksiz girmeniz gerekiyor.')
      return
    }

    startTransition(async () => {
      const reconcileResult = await reconcileCart('checkout_submit')
      if (!reconcileResult.success) {
        setError('Cart validation failed. Please refresh and try again.')
        return
      }

      const checkoutItems = reconcileResult.items
      if (checkoutItems.length === 0) {
        setError('Your cart is empty after stock/price validation.')
        return
      }

      const normalizedItems = checkoutItems.map((item) => ({
        partId: item.partId,
        quantity: item.quantity
      }))

      const result = await createCheckoutOrder({
        items: normalizedItems,
        contactEmail: user?.email || contactEmail.trim(),
        shippingAddress: address,
        shippingMethod,
        paymentMethod,
        paymentCard:
          paymentMethod === 'TAMI'
            ? {
                holderName: paymentCard.holderName.trim(),
                number: paymentCard.number,
                cvv: paymentCard.cvv,
                expireMonth: Number(paymentCard.expireMonth),
                expireYear: Number(paymentCard.expireYear),
                installmentCount: paymentCard.installmentCount
              }
            : undefined,
        note: note.trim(),
        locale
      })

      if (!result.success) {
        setError(result.message)
        return
      }

      window.location.assign(result.redirectUrl)
    })
  }

  if (cart.length === 0) {
    return (
      <div className="min-h-screen bg-muted">
        <main className="mx-auto max-w-3xl px-4 py-20">
          <div className="rounded-xl border border-border bg-background p-8 text-center shadow-sm">
            <h1 className="text-2xl font-semibold text-foreground">Your cart is empty</h1>
            <p className="mt-2 text-muted-foreground">Add products before starting checkout.</p>
            <Button className="mt-6" onClick={() => router.push(`/${locale}`)}>
              Continue Shopping
            </Button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-muted">
      <main className="mx-auto max-w-7xl px-4 py-8">
        <Link
          href={`/${locale}`}
          className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to shopping
        </Link>

        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <section className="space-y-6">
            {!user?.id && (
              <div className="rounded-md border border-warning/20 bg-warning/10 p-4 text-amber-900">
                Guest checkout is enabled. Please enter a valid email address to continue.
              </div>
            )}

            <div className="rounded-xl border border-border bg-background p-5 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-foreground">1. Shipping Address</h2>
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  className="md:col-span-2"
                  placeholder="Email"
                  type="email"
                  value={user?.email || contactEmail}
                  disabled={Boolean(user?.email)}
                  onChange={(e) => setContactEmail(e.target.value)}
                />
                <Input
                  placeholder="Full name"
                  value={address.fullName}
                  onChange={(e) =>
                    setAddress((prev) => ({ ...prev, fullName: e.target.value }))
                  }
                />
                <Input
                  placeholder="Phone"
                  value={address.phone}
                  onChange={(e) =>
                    setAddress((prev) => ({ ...prev, phone: e.target.value }))
                  }
                />
                <Input
                  className="md:col-span-2"
                  placeholder="Address line 1"
                  value={address.line1}
                  onChange={(e) =>
                    setAddress((prev) => ({ ...prev, line1: e.target.value }))
                  }
                />
                <Input
                  className="md:col-span-2"
                  placeholder="Address line 2 (optional)"
                  value={address.line2}
                  onChange={(e) =>
                    setAddress((prev) => ({ ...prev, line2: e.target.value }))
                  }
                />
                <Input
                  placeholder="City"
                  value={address.city}
                  onChange={(e) =>
                    setAddress((prev) => ({ ...prev, city: e.target.value }))
                  }
                />
                <Input
                  placeholder="Postal code"
                  value={address.postalCode}
                  onChange={(e) =>
                    setAddress((prev) => ({ ...prev, postalCode: e.target.value }))
                  }
                />
                <Input
                  className="md:col-span-2"
                  placeholder="Country"
                  value={address.country}
                  onChange={(e) =>
                    setAddress((prev) => ({ ...prev, country: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="rounded-xl border border-border bg-background p-5 shadow-sm">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
                <Truck className="h-4 w-4" />
                2. Shipping Method
              </h2>
              <div className="space-y-2">
                <label className="flex cursor-pointer items-center justify-between rounded-md border p-3">
                  <span>Standard (2-4 business days)</span>
                  <div className="flex items-center gap-2">
                    <span>{SHIPPING_FEE_BY_METHOD.STANDARD.toFixed(2)} TRY</span>
                    <input
                      type="radio"
                      name="shipping"
                      checked={shippingMethod === 'STANDARD'}
                      onChange={() => setShippingMethod('STANDARD')}
                    />
                  </div>
                </label>
                <label className="flex cursor-pointer items-center justify-between rounded-md border p-3">
                  <span>Express (next business day)</span>
                  <div className="flex items-center gap-2">
                    <span>{SHIPPING_FEE_BY_METHOD.EXPRESS.toFixed(2)} TRY</span>
                    <input
                      type="radio"
                      name="shipping"
                      checked={shippingMethod === 'EXPRESS'}
                      onChange={() => setShippingMethod('EXPRESS')}
                    />
                  </div>
                </label>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-background p-5 shadow-sm">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
                <CreditCard className="h-4 w-4" />
                3. Payment
              </h2>
              <div className="space-y-3">
                <label className="flex cursor-pointer items-start justify-between rounded-xl border p-4">
                  <div>
                    <p className="font-medium text-foreground">Tami ile Kartla Odeme</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Kart bilgileriniz siparis aninda Tami&apos;nin `/payment/auth` servisine
                      gonderilir.
                    </p>
                  </div>
                  <input
                    type="radio"
                    name="payment"
                    checked={paymentMethod === 'TAMI'}
                    onChange={() => setPaymentMethod('TAMI')}
                  />
                </label>

                <label className="flex cursor-pointer items-start justify-between rounded-xl border p-4">
                  <div>
                    <p className="font-medium text-foreground">Cash on delivery</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Create your order instantly and pay when it arrives.
                    </p>
                  </div>
                  <input
                    type="radio"
                    name="payment"
                    checked={paymentMethod === 'CASH_ON_DELIVERY'}
                    onChange={() => setPaymentMethod('CASH_ON_DELIVERY')}
                  />
                </label>
              </div>

              {paymentMethod === 'TAMI' && (
                <div className="mt-4 space-y-4">
                  <div className="rounded-xl border border-border bg-accent p-4 text-sm text-primary">
                    <div className="flex items-start gap-2">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                      <p>
                        Kart bilgileri veritabanina kaydedilmez; odeme istegi dogrudan Tami&apos;nin
                        `payment/auth` endpoint&apos;ine iletilir.
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <Input
                      className="md:col-span-2"
                      placeholder="Kart uzerindeki ad soyad"
                      autoComplete="cc-name"
                      value={paymentCard.holderName}
                      onChange={(e) =>
                        setPaymentCard((prev) => ({ ...prev, holderName: e.target.value }))
                      }
                    />
                    <Input
                      className="md:col-span-2"
                      placeholder="Kart numarasi"
                      inputMode="numeric"
                      autoComplete="cc-number"
                      value={formatCardNumber(paymentCard.number)}
                      onChange={(e) =>
                        setPaymentCard((prev) => ({
                          ...prev,
                          number: digitsOnly(e.target.value, 19)
                        }))
                      }
                    />
                    <Input
                      placeholder="CVV"
                      inputMode="numeric"
                      autoComplete="cc-csc"
                      value={paymentCard.cvv}
                      onChange={(e) =>
                        setPaymentCard((prev) => ({
                          ...prev,
                          cvv: digitsOnly(e.target.value, 4)
                        }))
                      }
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        placeholder="Ay"
                        inputMode="numeric"
                        autoComplete="cc-exp-month"
                        value={paymentCard.expireMonth}
                        onChange={(e) =>
                          setPaymentCard((prev) => ({
                            ...prev,
                            expireMonth: digitsOnly(e.target.value, 2)
                          }))
                        }
                      />
                      <Input
                        placeholder="Yil"
                        inputMode="numeric"
                        autoComplete="cc-exp-year"
                        value={paymentCard.expireYear}
                        onChange={(e) =>
                          setPaymentCard((prev) => ({
                            ...prev,
                            expireYear: digitsOnly(e.target.value, 4)
                          }))
                        }
                      />
                    </div>
                    <label className="flex flex-col gap-2 text-sm text-foreground">
                      <span>Taksit</span>
                      <select
                        className=" bg-background px-3 text-sm text-foreground"
                        value={paymentCard.installmentCount}
                        onChange={(e) =>
                          setPaymentCard((prev) => ({
                            ...prev,
                            installmentCount: Number(e.target.value)
                          }))
                        }
                      >
                        {[1, 2, 3, 6, 9, 12].map((count) => (
                          <option key={count} value={count}>
                            {count === 1 ? 'Pesin' : `${count} taksit`}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              )}

              <Input
                className="mt-4"
                placeholder="Order note (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </section>

          <aside className="h-fit rounded-xl border border-border bg-background p-5 shadow-sm">
            <h3 className="mb-4 text-lg font-semibold text-foreground">4. Order Summary</h3>
            <div className="space-y-3">
              {cart.map((item) => (
                <div key={item.id} className="flex items-center justify-between text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{item.name}</p>
                    <p className="text-muted-foreground">
                      {item.quantity} x {item.price.toFixed(2)} TRY
                    </p>
                  </div>
                  <p className="font-semibold text-foreground">
                    {(item.quantity * item.price).toFixed(2)} TRY
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2 border-t pt-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{subtotal.toFixed(2)} TRY</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Shipping</span>
                <span>{shippingFee.toFixed(2)} TRY</span>
              </div>
              <div className="flex justify-between text-base font-semibold text-foreground">
                <span>Total</span>
                <span>{total.toFixed(2)} TRY</span>
              </div>
            </div>

            <div className="mt-4 rounded-md border border-border bg-muted p-3">
              <label className="flex cursor-pointer items-start gap-3 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={acceptedLegalTerms}
                  onChange={(event) => setAcceptedLegalTerms(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-input text-foreground"
                />
                <span>
                  Mesafeli Satis Sozlesmesi, On Bilgilendirme Formu ve Gizlilik Politikasi
                  metinlerini okudum ve kabul ediyorum.{' '}
                  <Link
                    href={`/${locale}/mesafeli-satis-sozlesmesi`}
                    className="font-medium text-primary hover:underline"
                  >
                    Sozlesme
                  </Link>{' '}
                  |{' '}
                  <Link
                    href={`/${locale}/on-bilgilendirme-formu`}
                    className="font-medium text-primary hover:underline"
                  >
                    On Bilgilendirme
                  </Link>{' '}
                  |{' '}
                  <Link
                    href={`/${locale}/gizlilik-politikasi`}
                    className="font-medium text-primary hover:underline"
                  >
                    Gizlilik
                  </Link>
                </span>
              </label>
            </div>

            {error && (
              <div className="mt-4 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <Button
              className="mt-5 w-full"
              disabled={isPending}
              onClick={handleSubmit}
            >
              {isPending
                ? paymentMethod === 'TAMI'
                  ? 'Tami odemesi isleniyor...'
                  : 'Placing Order...'
                : paymentMethod === 'TAMI'
                  ? 'Kart ile Odemeyi Tamamla'
                  : 'Place Order'}
            </Button>
          </aside>
        </div>
      </main>
    </div>
  )
}
