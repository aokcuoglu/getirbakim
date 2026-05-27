import { AdminLayout } from '@/components/admin/admin-layout'
import { requireAdminAuth } from '@/lib/admin-auth'

export default async function AdminGuardLayout({
  children,
  params
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  await requireAdminAuth({ locale, redirectTo: `/${locale}/admin` })
  return <AdminLayout>{children}</AdminLayout>
}
