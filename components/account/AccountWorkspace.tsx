'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Bell,
  BookOpenText,
  Car,
  ClipboardList,
  CreditCard,
  KeyRound,
  Menu,
  MessageSquare,
  Percent,
  Phone,
  ShieldCheck,
  Star,
  UserRound,
  Wrench
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { OrderStatusBadge } from '@/components/orders/OrderStatusBadge'
import { Link } from '@/lib/navigation'
import { removeUserVehicle } from '@/lib/actions/user-vehicles'
import { useShop } from '@/components/ShopProvider'
import type { Vehicle } from '@/types'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { usePathname, useRouter } from '@/lib/navigation'
import { useTranslations } from 'next-intl'

type AccountOrder = {
  id: number
  orderNumber: string
  status: string
  paymentStatus: string
  totalAmount: number
  currency: string
  createdAt: string
  itemsCount: number
}

type GarageVehicleEntry = {
  id: number
  createdAt: string | null
  vehicle: Vehicle
}

type AccountWorkspaceProps = {
  locale: string
  initialSection: SectionKey
  user: {
    id: string
    name: string
    email: string
  }
  orders: AccountOrder[]
  garageVehicles: GarageVehicleEntry[]
}

type SectionKey =
  | 'profile'
  | 'password'
  | 'notifications'
  | 'orders'
  | 'reviews'
  | 'appointments'
  | 'following'
  | 'garage'
  | 'iban'
  | 'coupons'

type Coupon = {
  id: string
  code: string
  title: string
  expiresAt: string
  status: 'ACTIVE' | 'USED' | 'EXPIRED'
}

type Review = {
  id: number
  product: string
  rating: number
  comment: string
  status: 'PUBLISHED' | 'PENDING'
}

type ServiceAppointment = {
  id: number
  title: string
  date: string
  status: 'PLANNED' | 'COMPLETED'
}

type FollowedPart = {
  id: number
  title: string
  oem: string
  brand: string
  inStock: boolean
}

type IbanInfo = {
  id: number
  title: string
  iban: string
  isPrimary: boolean
}

const formatMoney = (value: number, currency: string, locale: string) =>
  value.toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-US', {
    style: 'currency',
    currency
  })

const formatDateTime = (iso: string, locale: string) =>
  new Date(iso).toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-US')

export function AccountWorkspace({
  locale,
  initialSection,
  user,
  orders,
  garageVehicles
}: AccountWorkspaceProps) {
  const t = useTranslations('AccountWorkspace')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const {
    selectedVehicle,
    handleVehicleSelect,
    clearSelectedVehicle,
    vehicleHistory
  } = useShop()

  const [activeSection, setActiveSection] = useState<SectionKey>(initialSection)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [profile, setProfile] = useState({
    fullName: user.name,
    email: user.email,
    phone: '',
    addressLine: '',
    city: '',
    district: '',
    postalCode: ''
  })
  const [password, setPassword] = useState({
    current: '',
    next: '',
    confirm: ''
  })
  const [notificationSettings, setNotificationSettings] = useState({
    sms: true,
    email: true,
    call: false,
    push: true
  })
  const [reviews, setReviews] = useState<Review[]>([
    {
      id: 1,
      product: 'BOSCH Yağ Filtresi',
      rating: 5,
      comment: t('auto.k001'),
      status: 'PUBLISHED'
    },
    {
      id: 2,
      product: 'MANN Hava Filtresi',
      rating: 4,
      comment: t('auto.k002'),
      status: 'PENDING'
    }
  ])
  const [appointments] = useState<ServiceAppointment[]>([
    {
      id: 1,
      title: t('auto.k003'),
      date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'PLANNED'
    }
  ])
  const [followedParts, setFollowedParts] = useState<FollowedPart[]>([
    {
      id: 1,
      title: 'ATE Fren Balatası Seti',
      oem: '13.0460-7117.2',
      brand: 'ATE',
      inStock: true
    },
    {
      id: 2,
      title: 'SKF Triger Seti',
      oem: 'VKMA 03256',
      brand: 'SKF',
      inStock: false
    }
  ])
  const [followInput, setFollowInput] = useState('')
  const [garage, setGarage] = useState<GarageVehicleEntry[]>(garageVehicles)
  const [ibans, setIbans] = useState<IbanInfo[]>([
    {
      id: 1,
      title: t('auto.k004'),
      iban: 'TR00 0000 0000 0000 0000 0000 00',
      isPrimary: true
    }
  ])
  const [newIban, setNewIban] = useState('')
  const [coupons, setCoupons] = useState<Coupon[]>([
    {
      id: '1',
      code: 'WELCOME15',
      title: t('auto.k005'),
      expiresAt: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'ACTIVE'
    },
    {
      id: '2',
      code: 'SPRING5',
      title: t('auto.k006'),
      expiresAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'EXPIRED'
    }
  ])
  const [orderFilter, setOrderFilter] = useState<'ALL' | 'OPEN' | 'COMPLETED'>(
    'ALL'
  )

  const sections = useMemo(
    () => [
      {
        key: 'profile' as const,
        icon: UserRound,
        label: t('auto.k007')
      },
      {
        key: 'password' as const,
        icon: KeyRound,
        label: t('auto.k008')
      },
      {
        key: 'notifications' as const,
        icon: Bell,
        label: t('auto.k009')
      },
      {
        key: 'orders' as const,
        icon: ClipboardList,
        label: t('auto.k010')
      },
      {
        key: 'reviews' as const,
        icon: MessageSquare,
        label: t('auto.k011')
      },
      {
        key: 'appointments' as const,
        icon: Wrench,
        label: t('auto.k012')
      },
      {
        key: 'following' as const,
        icon: Star,
        label: t('auto.k013')
      },
      {
        key: 'garage' as const,
        icon: Car,
        label: t('auto.k014')
      },
      {
        key: 'iban' as const,
        icon: CreditCard,
        label: t('auto.k015')
      },
      {
        key: 'coupons' as const,
        icon: Percent,
        label: t('auto.k016')
      }
    ],
    [t]
  )

  const filteredOrders = useMemo(() => {
    if (orderFilter === 'ALL') return orders
    if (orderFilter === 'OPEN') {
      return orders.filter(
        (order) => !['DELIVERED', 'COMPLETED', 'CANCELLED'].includes(order.status)
      )
    }
    return orders.filter((order) =>
      ['DELIVERED', 'COMPLETED'].includes(order.status)
    )
  }, [orders, orderFilter])

  const handleSaveProfile = () => {
    toast.success(
      t('auto.k017')
    )
  }

  const handleChangePassword = () => {
    if (!password.current || !password.next || !password.confirm) {
      toast.error(t('auto.k018'))
      return
    }
    if (password.next !== password.confirm) {
      toast.error(
        t('auto.k019')
      )
      return
    }
    setPassword({
      current: '',
      next: '',
      confirm: ''
    })
    toast.success(
      t('auto.k020')
    )
  }

  const handleSaveNotifications = () => {
    toast.success(
      t('auto.k021')
    )
  }

  const handleToggleReviewStatus = (reviewId: number) => {
    setReviews((prev) =>
      prev.map((review) =>
        review.id === reviewId
          ? {
              ...review,
              status: review.status === 'PUBLISHED' ? 'PENDING' : 'PUBLISHED'
            }
          : review
      )
    )
  }

  const handleDeleteReview = (reviewId: number) => {
    setReviews((prev) => prev.filter((review) => review.id !== reviewId))
    toast.success(t('auto.k022'))
  }

  const handleAddFollowedPart = () => {
    const cleaned = followInput.trim()
    if (!cleaned) return
    const nextItem: FollowedPart = {
      id: Date.now(),
      title: cleaned,
      oem: 'N/A',
      brand: '-',
      inStock: false
    }
    setFollowedParts((prev) => [nextItem, ...prev])
    setFollowInput('')
    toast.success(t('auto.k023'))
  }

  const handleRemoveFollowedPart = (id: number) => {
    setFollowedParts((prev) => prev.filter((item) => item.id !== id))
  }

  const handleRemoveGarageVehicle = async (entryId: number) => {
    const target = garage.find((entry) => entry.id === entryId)
    if (!target) return

    setGarage((prev) => prev.filter((entry) => entry.id !== entryId))

    if (
      selectedVehicle &&
      String(selectedVehicle.id) === String(target.vehicle.id)
    ) {
      clearSelectedVehicle()
    }

    const result = await removeUserVehicle(user.id, entryId)
    if (!result?.success) {
      setGarage((prev) => [target, ...prev])
      toast.error(
        t('auto.k024')
      )
      return
    }

    toast.success(t('auto.k025'))
  }

  const handleAddIban = () => {
    const value = newIban.trim().toUpperCase()
    if (!value.startsWith('TR') || value.length < 24) {
      toast.error(
        t('auto.k026')
      )
      return
    }
    const next: IbanInfo = {
      id: Date.now(),
      title: t('auto.k027'),
      iban: value,
      isPrimary: ibans.length === 0
    }
    setIbans((prev) => [...prev, next])
    setNewIban('')
  }

  const handleSetPrimaryIban = (id: number) => {
    setIbans((prev) =>
      prev.map((iban) => ({
        ...iban,
        isPrimary: iban.id === id
      }))
    )
  }

  const handleDeleteIban = (id: number) => {
    setIbans((prev) => prev.filter((iban) => iban.id !== id))
  }

  const handleCopyCoupon = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      toast.success(t('auto.k028'))
    } catch {
      toast.error(t('auto.k029'))
    }
  }

  const totalOrderAmount = orders.reduce((sum, order) => sum + order.totalAmount, 0)
  const firstName = (profile.fullName || user.name || '').trim().split(' ')[0] || user.name

  useEffect(() => {
    setActiveSection(initialSection)
  }, [initialSection])

  const handleSectionChange = (section: SectionKey) => {
    setActiveSection(section)

    if (!pathname) return

    const params = new URLSearchParams(searchParams.toString())
    if (section === 'profile') {
      params.delete('section')
    } else {
      params.set('section', section)
    }

    const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname
    router.replace(nextUrl)
  }

  const renderSectionMenu = (onSelect?: () => void, compact = false) => (
    <div className={compact ? 'space-y-1 px-2 pb-4' : 'mt-4 space-y-1'}>
      {sections.map((item) => {
        const Icon = item.icon
        const isActive = item.key === activeSection
        return (
          <button
            key={item.key}
            onClick={() => {
              handleSectionChange(item.key)
              onSelect?.()
            }}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-foreground hover:bg-muted'
            }`}
          >
            <Icon size={16} />
            <span className="font-medium">{item.label}</span>
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="grid gap-4 md:gap-5 lg:gap-6 lg:grid-cols-[280px_1fr]">
      <aside className="hidden lg:block lg:sticky lg:top-32 lg:h-fit">
        <div className="rounded-2xl border border-border bg-background p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            {t('auto.k030')}
          </p>
          <h1 className="mt-3 text-2xl font-bold text-foreground">
            {t('auto.k031')}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('auto.k032')}
          </p>

          {renderSectionMenu()}
        </div>
      </aside>

      <section className="space-y-4 md:space-y-6">
        <div className="lg:hidden rounded-2xl border border-border bg-background p-2.5 shadow-sm">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setIsMenuOpen(true)}
              className="h-9 w-9"
              aria-label={t('auto.k033')}
            >
              <Menu size={18} />
            </Button>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">
                {t('auto.k034')} {firstName}
              </p>
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            </div>
          </div>
        </div>

        <Sheet open={isMenuOpen} onOpenChange={setIsMenuOpen}>
          <SheetContent side="left" className="w-[min(88vw,320px)] p-0 lg:hidden">
            <SheetHeader className="border-b border-border px-4 py-4 text-left">
              <SheetTitle>{t('auto.k035')}</SheetTitle>
              <SheetDescription>
                {t('auto.k036')}
              </SheetDescription>
            </SheetHeader>
            {renderSectionMenu(() => setIsMenuOpen(false), true)}
          </SheetContent>
        </Sheet>

        <div className="grid gap-3 md:gap-4 md:grid-cols-3">
          <SummaryCard
            icon={<BookOpenText size={18} className="text-primary" />}
            label={t('auto.k037')}
            value={String(orders.length)}
          />
          <SummaryCard
            icon={<Phone size={18} className="text-success" />}
            label={t('auto.k038')}
            value={String(
              Object.values(notificationSettings).filter(Boolean).length
            )}
          />
          <SummaryCard
            icon={<ShieldCheck size={18} className="text-violet-600" />}
            label={t('auto.k039')}
            value={formatMoney(totalOrderAmount, 'TRY', locale)}
          />
        </div>

        <div className="rounded-2xl border border-border bg-background p-4 md:p-5 shadow-sm">
          {activeSection === 'profile' && (
            <SectionBlock
              title={t('auto.k040')}
              description={
                t('auto.k041')
              }
            >
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={t('auto.k042')}>
                  <Input
                    value={profile.fullName}
                    onChange={(e) =>
                      setProfile((prev) => ({
                        ...prev,
                        fullName: e.target.value
                      }))
                    }
                  />
                </Field>
                <Field label="Email">
                  <Input
                    type="email"
                    value={profile.email}
                    onChange={(e) =>
                      setProfile((prev) => ({
                        ...prev,
                        email: e.target.value
                      }))
                    }
                  />
                </Field>
                <Field label={t('auto.k043')}>
                  <Input
                    value={profile.phone}
                    onChange={(e) =>
                      setProfile((prev) => ({
                        ...prev,
                        phone: e.target.value
                      }))
                    }
                    placeholder="+90 5xx xxx xx xx"
                  />
                </Field>
                <Field label={t('auto.k044')}>
                  <Input
                    value={profile.postalCode}
                    onChange={(e) =>
                      setProfile((prev) => ({
                        ...prev,
                        postalCode: e.target.value
                      }))
                    }
                  />
                </Field>
                <Field label={t('auto.k045')}>
                  <Input
                    value={profile.city}
                    onChange={(e) =>
                      setProfile((prev) => ({
                        ...prev,
                        city: e.target.value
                      }))
                    }
                  />
                </Field>
                <Field label={t('auto.k046')}>
                  <Input
                    value={profile.district}
                    onChange={(e) =>
                      setProfile((prev) => ({
                        ...prev,
                        district: e.target.value
                      }))
                    }
                  />
                </Field>
              </div>
              <Field label={t('auto.k047')}>
                <Textarea
                  value={profile.addressLine}
                  onChange={(e) =>
                    setProfile((prev) => ({
                      ...prev,
                      addressLine: e.target.value
                    }))
                  }
                  placeholder={
                    t('auto.k048')
                  }
                />
              </Field>
              <div className="flex justify-end">
                <Button onClick={handleSaveProfile}>
                  {t('auto.k049')}
                </Button>
              </div>
            </SectionBlock>
          )}

          {activeSection === 'password' && (
            <SectionBlock
              title={t('auto.k050')}
              description={
                t('auto.k051')
              }
            >
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={t('auto.k052')}>
                  <Input
                    type="password"
                    value={password.current}
                    onChange={(e) =>
                      setPassword((prev) => ({
                        ...prev,
                        current: e.target.value
                      }))
                    }
                  />
                </Field>
                <div />
                <Field label={t('auto.k053')}>
                  <Input
                    type="password"
                    value={password.next}
                    onChange={(e) =>
                      setPassword((prev) => ({
                        ...prev,
                        next: e.target.value
                      }))
                    }
                  />
                </Field>
                <Field label={t('auto.k054')}>
                  <Input
                    type="password"
                    value={password.confirm}
                    onChange={(e) =>
                      setPassword((prev) => ({
                        ...prev,
                        confirm: e.target.value
                      }))
                    }
                  />
                </Field>
              </div>
              <div className="flex justify-end">
                <Button onClick={handleChangePassword}>
                  {t('auto.k055')}
                </Button>
              </div>
            </SectionBlock>
          )}

          {activeSection === 'notifications' && (
            <SectionBlock
              title={t('auto.k056')}
              description={
                t('auto.k057')
              }
            >
              <div className="grid gap-3 md:grid-cols-2">
                <ToggleRow
                  label={t('auto.k058')}
                  checked={notificationSettings.sms}
                  onCheckedChange={(checked) =>
                    setNotificationSettings((prev) => ({
                      ...prev,
                      sms: Boolean(checked)
                    }))
                  }
                />
                <ToggleRow
                  label={t('auto.k059')}
                  checked={notificationSettings.email}
                  onCheckedChange={(checked) =>
                    setNotificationSettings((prev) => ({
                      ...prev,
                      email: Boolean(checked)
                    }))
                  }
                />
                <ToggleRow
                  label={t('auto.k060')}
                  checked={notificationSettings.call}
                  onCheckedChange={(checked) =>
                    setNotificationSettings((prev) => ({
                      ...prev,
                      call: Boolean(checked)
                    }))
                  }
                />
                <ToggleRow
                  label={t('auto.k061')}
                  checked={notificationSettings.push}
                  onCheckedChange={(checked) =>
                    setNotificationSettings((prev) => ({
                      ...prev,
                      push: Boolean(checked)
                    }))
                  }
                />
              </div>
              <div className="flex justify-end">
                <Button onClick={handleSaveNotifications}>
                  {t('auto.k062')}
                </Button>
              </div>
            </SectionBlock>
          )}

          {activeSection === 'orders' && (
            <SectionBlock
              title={t('auto.k063')}
              description={
                t('auto.k064')
              }
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">
                  {t('ordersListed', { count: filteredOrders.length })}
                </div>
                <Select
                  value={orderFilter}
                  onValueChange={(value) =>
                    setOrderFilter(value as 'ALL' | 'OPEN' | 'COMPLETED')
                  }
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder={t('auto.k065')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">
                      {t('auto.k066')}
                    </SelectItem>
                    <SelectItem value="OPEN">
                      {t('auto.k067')}
                    </SelectItem>
                    <SelectItem value="COMPLETED">
                      {t('auto.k068')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {filteredOrders.length === 0 ? (
                <EmptyState
                  text={
                    t('auto.k069')
                  }
                />
              ) : (
                <div className="space-y-3">
                  {filteredOrders.map((order) => (
                    <div
                      key={order.id}
                      className="rounded-xl border border-border bg-muted p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {order.orderNumber}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatDateTime(order.createdAt, locale)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t('auto.k070')}: {order.itemsCount}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <OrderStatusBadge status={order.status} />
                          <OrderStatusBadge status={order.paymentStatus} />
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-foreground">
                          {formatMoney(order.totalAmount, order.currency, locale)}
                        </p>
                        <div className="flex gap-2">
                          <Link href={`/account/orders/${order.id}`}>
                            <Button variant="outline" size="sm">
                              {t('auto.k071')}
                            </Button>
                          </Link>
                          <Button
                            size="sm"
                            onClick={() =>
                              toast.info(
                                t('auto.k072')
                              )
                            }
                          >
                            {t('auto.k073')}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionBlock>
          )}

          {activeSection === 'reviews' && (
            <SectionBlock
              title={t('auto.k074')}
              description={
                t('auto.k075')
              }
            >
              {reviews.length === 0 ? (
                <EmptyState
                  text={t('auto.k076')}
                />
              ) : (
                <div className="space-y-3">
                  {reviews.map((review) => (
                    <div
                      key={review.id}
                      className="rounded-xl border border-border bg-muted p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-foreground">{review.product}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t('auto.k077')}: {review.rating}/5
                          </p>
                          <p className="mt-2 text-sm text-foreground">{review.comment}</p>
                        </div>
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            review.status === 'PUBLISHED'
                              ? 'bg-success/15 text-success'
                              : 'bg-warning/15 text-warning'
                          }`}
                        >
                          {review.status === 'PUBLISHED'
                            ? t('auto.k078')
                            : t('auto.k079')}
                        </span>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleToggleReviewStatus(review.id)}
                        >
                          {review.status === 'PUBLISHED'
                            ? t('auto.k080')
                            : t('auto.k081')}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleDeleteReview(review.id)}
                        >
                          {t('auto.k082')}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionBlock>
          )}

          {activeSection === 'appointments' && (
            <SectionBlock
              title={t('auto.k083')}
              description={
                t('auto.k084')
              }
            >
              <div className="rounded-xl border border-dashed border-input bg-muted p-4">
                <p className="text-sm text-foreground">
                  {t('auto.k085')}
                </p>
              </div>

              <div className="space-y-3">
                {appointments.map((appointment) => (
                  <div
                    key={appointment.id}
                    className="rounded-xl border border-border bg-muted p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold text-foreground">{appointment.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(appointment.date, locale)}
                        </p>
                      </div>
                      <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-foreground">
                        {appointment.status === 'PLANNED'
                          ? t('auto.k086')
                          : t('auto.k087')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={() =>
                    toast.info(
                      t('auto.k088')
                    )
                  }
                >
                  {t('auto.k089')}
                </Button>
              </div>
            </SectionBlock>
          )}

          {activeSection === 'following' && (
            <SectionBlock
              title={t('auto.k090')}
              description={
                t('auto.k091')
              }
            >
              <div className="mb-4 flex flex-wrap gap-2">
                <Input
                  value={followInput}
                  onChange={(e) => setFollowInput(e.target.value)}
                  placeholder={
                    t('auto.k092')
                  }
                  className="max-w-md"
                />
                <Button onClick={handleAddFollowedPart}>
                  {t('auto.k093')}
                </Button>
              </div>

              {followedParts.length === 0 ? (
                <EmptyState
                  text={t('auto.k094')}
                />
              ) : (
                <div className="space-y-3">
                  {followedParts.map((part) => (
                    <div
                      key={part.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted p-4"
                    >
                      <div>
                        <p className="font-semibold text-foreground">{part.title}</p>
                        <p className="text-xs text-muted-foreground">
                          OEM: {part.oem} • {part.brand}
                        </p>
                        <p className="mt-1 text-xs font-medium">
                          <span
                            className={
                              part.inStock ? 'text-success' : 'text-warning'
                            }
                          >
                            {part.inStock
                              ? t('auto.k095')
                              : t('auto.k096')}
                          </span>
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRemoveFollowedPart(part.id)}
                      >
                        {t('auto.k097')}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </SectionBlock>
          )}

          {activeSection === 'garage' && (
            <SectionBlock
              title={t('auto.k098')}
              description={
                t('auto.k099')
              }
            >
              <div className="mb-4 rounded-xl border border-border bg-muted p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('auto.k100')}
                </p>
                <p className="mt-2 font-semibold text-foreground">
                  {selectedVehicle
                    ? `${selectedVehicle.year} ${selectedVehicle.make} ${selectedVehicle.model}`
                    : t('auto.k101')}
                </p>
                {selectedVehicle && (
                  <div className="mt-3">
                    <Button variant="outline" size="sm" onClick={clearSelectedVehicle}>
                      {t('auto.k102')}
                    </Button>
                  </div>
                )}
              </div>

              {garage.length === 0 && vehicleHistory.length === 0 ? (
                <EmptyState
                  text={
                    t('auto.k103')
                  }
                />
              ) : (
                <div className="space-y-3">
                  {garage.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-xl border border-border bg-muted p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-foreground">
                            {entry.vehicle.year} {entry.vehicle.make} {entry.vehicle.model}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {entry.vehicle.engine}
                            {entry.vehicle.fuel ? ` • ${entry.vehicle.fuel}` : ''}
                          </p>
                          {entry.createdAt && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {t('auto.k104')}:{' '}
                              {formatDateTime(entry.createdAt, locale)}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleVehicleSelect(entry.vehicle)}
                          >
                            {t('auto.k105')}
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleRemoveGarageVehicle(entry.id)}
                          >
                            {t('auto.k106')}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionBlock>
          )}

          {activeSection === 'iban' && (
            <SectionBlock
              title={t('auto.k107')}
              description={
                t('auto.k108')
              }
            >
              <div className="mb-4 flex flex-wrap gap-2">
                <Input
                  placeholder="TR00 0000 0000 0000 0000 0000 00"
                  value={newIban}
                  onChange={(e) => setNewIban(e.target.value)}
                  className="max-w-md"
                />
                <Button onClick={handleAddIban}>
                  {t('auto.k109')}
                </Button>
              </div>

              {ibans.length === 0 ? (
                <EmptyState
                  text={t('auto.k110')}
                />
              ) : (
                <div className="space-y-3">
                  {ibans.map((iban) => (
                    <div
                      key={iban.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted p-4"
                    >
                      <div>
                        <p className="font-semibold text-foreground">{iban.title}</p>
                        <p className="text-sm text-muted-foreground">{iban.iban}</p>
                        {iban.isPrimary && (
                          <p className="mt-1 text-xs font-semibold text-success">
                            {t('auto.k111')}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {!iban.isPrimary && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSetPrimaryIban(iban.id)}
                          >
                            {t('auto.k112')}
                          </Button>
                        )}
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteIban(iban.id)}
                        >
                          {t('auto.k113')}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionBlock>
          )}

          {activeSection === 'coupons' && (
            <SectionBlock
              title={t('auto.k114')}
              description={
                t('auto.k115')
              }
            >
              {coupons.length === 0 ? (
                <EmptyState
                  text={t('auto.k116')}
                />
              ) : (
                <div className="space-y-3">
                  {coupons.map((coupon) => (
                    <div
                      key={coupon.id}
                      className="rounded-xl border border-border bg-muted p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-foreground">{coupon.title}</p>
                          <p className="mt-1 text-sm text-foreground">{coupon.code}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t('auto.k117')}:{' '}
                            {formatDateTime(coupon.expiresAt, locale)}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            coupon.status === 'ACTIVE'
                              ? 'bg-success/15 text-success'
                              : coupon.status === 'USED'
                                ? 'bg-muted text-foreground'
                                : 'bg-destructive/15 text-rose-700'
                          }`}
                        >
                          {coupon.status === 'ACTIVE'
                            ? t('auto.k118')
                            : coupon.status === 'USED'
                              ? t('auto.k119')
                              : t('auto.k120')}
                        </span>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleCopyCoupon(coupon.code)}
                          disabled={coupon.status !== 'ACTIVE'}
                        >
                          {t('auto.k121')}
                        </Button>
                        {coupon.status === 'ACTIVE' && (
                          <Button
                            size="sm"
                            onClick={() => {
                              setCoupons((prev) =>
                                prev.map((item) =>
                                  item.id === coupon.id
                                    ? { ...item, status: 'USED' }
                                    : item
                                )
                              )
                              toast.success(
                                t('auto.k122')
                              )
                            }}
                          >
                            {t('auto.k123')}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionBlock>
          )}
        </div>
      </section>
    </div>
  )
}

function SectionBlock({
  title,
  description,
  children
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="animate-in fade-in-0 duration-200 space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  )
}

function ToggleRow({
  label,
  checked,
  onCheckedChange
}: {
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between rounded-md border border-border bg-muted px-3 py-2.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <Checkbox checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-input bg-muted p-4 text-sm text-muted-foreground">
      {text}
    </div>
  )
}

function SummaryCard({
  icon,
  label,
  value
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="rounded-2xl border border-border bg-background p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <div className="rounded-full bg-muted p-2">{icon}</div>
      </div>
      <p className="mt-3 text-2xl font-bold text-foreground">{value}</p>
    </div>
  )
}
