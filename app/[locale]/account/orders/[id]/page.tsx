import { notFound } from 'next/navigation'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import { OrderDetailView } from '@/components/orders/OrderDetailView'
import { getMainNavCategories } from '@/lib/mainNavCategories'
import { getOrderForUser } from '@/lib/orders/service'
import { createClient } from '@/lib/supabase/server'
import { getTranslations } from 'next-intl/server'

export default async function AccountOrderDetailPage(props: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await props.params
  const orderId = Number(id)
  if (!Number.isInteger(orderId) || orderId <= 0) {
    notFound()
  }

  const navbarCategories = await getMainNavCategories(locale)
  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user?.id) {
    notFound()
  }

  const order = await getOrderForUser(user.id, orderId)
  if (!order) {
    notFound()
  }
  const t = await getTranslations({ locale, namespace: 'AccountOrderDetailPage' })

  return (
    <div className="min-h-screen bg-muted">
      <Navbar navbarCategories={navbarCategories} />
      <main className="mx-auto max-w-6xl px-4 pb-12 pt-4 md:pt-8">
        <div className="mb-6 md:mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            {t('myOrders')}
          </p>
          <h1 className="mt-3 text-3xl font-bold text-foreground">{order.orderNumber}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('description')}
          </p>
        </div>

        <OrderDetailView order={order} />
      </main>
      <Footer />
    </div>
  )
}
