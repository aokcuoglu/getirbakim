import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/server'
import { getMainNavCategories } from '@/lib/mainNavCategories'
import { formatOrderNumber } from '@/lib/orders/types'
import { Link } from '@/lib/navigation'
import ClearCartOnMount from './ClearCartOnMount'

export default async function CheckoutResultPage(props: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{
    orderId?: string
    state?: string
    error?: string
  }>
}) {
  const { locale } = await props.params
  const searchParams = await props.searchParams
  const navbarCategories = await getMainNavCategories(locale)

  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  const orderId = Number(searchParams.orderId || '0')
  const orderNumber =
    Number.isInteger(orderId) && orderId > 0 ? formatOrderNumber(orderId) : null
  const state = searchParams.state || 'success'
  const isSuccess = state === 'success' || state === 'cod'
  const isPendingVerification = state === 'pending_verification'

  const title = isPendingVerification
    ? 'Odeme dogrulaniyor'
    : isSuccess
      ? 'Siparisiniz alindi'
      : 'Odeme tamamlanamadi'

  const description = isPendingVerification
    ? searchParams.error ||
      'Tami tarafindan donus alindi ancak sonuc henuz kesinlesmedi. Lutfen siparis ekraninizi biraz sonra tekrar kontrol edin.'
    : isSuccess
      ? state === 'cod'
        ? 'Kapida odeme siparisiniz olusturuldu. Operasyon ekibi siparisinizi isleme alacak.'
        : 'Odemeniz dogrulandi. Siparisiniz isleme alinmak uzere kaydedildi.'
      : searchParams.error ||
        'Odeme dogrulanamadi. Lutfen tekrar deneyin veya farkli bir odeme yontemi secin.'

  return (
    <div className="min-h-screen bg-slate-50">
      {state !== 'failure' ? <ClearCartOnMount /> : null}
      <Navbar navbarCategories={navbarCategories} />
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-36">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mx-auto max-w-xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
              Checkout Result
            </p>
            <h1 className="mt-3 text-3xl font-bold text-slate-950">{title}</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>

            {orderNumber && (
              <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Siparis Numaraniz
                </p>
                <p className="mt-2 text-2xl font-bold text-slate-900">{orderNumber}</p>
              </div>
            )}

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href="/">
                <Button variant="outline">Alisverise Don</Button>
              </Link>

              {user?.id ? (
                <Link
                  href={orderId > 0 ? `/account/orders/${orderId}` : '/account?section=orders'}
                >
                  <Button>Siparisi Goruntule</Button>
                </Link>
              ) : (
                <Link href="/orders/lookup">
                  <Button>Siparis Sorgula</Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
