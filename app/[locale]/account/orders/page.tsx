import { redirect } from 'next/navigation'

export default async function AccountOrdersPage(props: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await props.params
  redirect(`/${locale}/account?section=orders`)
}
