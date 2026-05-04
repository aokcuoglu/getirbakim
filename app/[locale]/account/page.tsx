import Footer from '@/components/Footer'
import Navbar from '@/components/Navbar'
import { Button } from '@/components/ui/button'
import { getUserVehicles } from '@/lib/actions/user-vehicles'
import { getMainNavCategories } from '@/lib/mainNavCategories'
import { getOrdersForUser } from '@/lib/orders/service'
import { Link } from '@/lib/navigation'
import { createClient } from '@/lib/supabase/server'
import { AccountWorkspace } from '@/components/account/AccountWorkspace'
import type { Vehicle } from '@/types'
import { getTranslations } from 'next-intl/server'

const ACCOUNT_SECTIONS = [
  'profile',
  'password',
  'notifications',
  'orders',
  'reviews',
  'appointments',
  'following',
  'garage',
  'iban',
  'coupons'
] as const

type AccountSection = (typeof ACCOUNT_SECTIONS)[number]

const ACCOUNT_SECTION_SET = new Set<string>(ACCOUNT_SECTIONS)

export default async function AccountPage(props: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ section?: string }>
}) {
  const { locale } = await props.params
  const searchParams = await props.searchParams
  const navbarCategories = await getMainNavCategories(locale)
  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()
  const initialSection: AccountSection =
    typeof searchParams.section === 'string' &&
    ACCOUNT_SECTION_SET.has(searchParams.section)
      ? (searchParams.section as AccountSection)
    : 'profile'

  if (!user?.id) {
    const t = await getTranslations({ locale, namespace: 'AccountPage' })
    return (
      <div className="min-h-screen bg-slate-50">
        <Navbar navbarCategories={navbarCategories} />
        <main className="mx-auto max-w-4xl px-4 pb-12 pt-4 md:pt-8">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
            <h1 className="text-2xl font-bold text-slate-900">
              {t('signInToView')}
            </h1>
            <p className="mt-3 text-sm text-slate-600">
              {t('description')}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/">
                <Button>{t('backToHome')}</Button>
              </Link>
              <Link href="/orders/lookup">
                <Button variant="outline">
                  {t('lookupGuestOrders')}
                </Button>
              </Link>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    )
  }

  const orders = await getOrdersForUser(user.id)
  const garageRows = await getUserVehicles(user.id)

  const serializedOrders = orders.map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    totalAmount: order.totalAmount,
    currency: order.currency,
    createdAt: order.createdAt,
    itemsCount: order.itemsCount
  }))

  const garageVehicles = garageRows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    vehicle: row.vehicle as Vehicle
  }))

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar navbarCategories={navbarCategories} />
      <main className="mx-auto max-w-[1280px] px-4 pb-12 pt-4 md:pt-8">
        <AccountWorkspace
          locale={locale}
          initialSection={initialSection}
          user={{
            id: user.id,
            name:
              (user.user_metadata?.full_name as string | undefined) ||
              (user.user_metadata?.name as string | undefined) ||
              user.email ||
              'User',
            email: user.email || ''
          }}
          orders={serializedOrders}
          garageVehicles={garageVehicles}
        />
      </main>
      <Footer />
    </div>
  )
}
