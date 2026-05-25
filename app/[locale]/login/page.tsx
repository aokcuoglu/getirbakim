import { LoginForm } from '@/components/auth/LoginForm'
import { Link } from '@/lib/navigation'
import { useTranslations } from 'next-intl'

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ redirect?: string }>
}) {
  const t = useTranslations('Auth')
  const { redirect } = await searchParams

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2">
      <LoginForm redirectTo={redirect} />
      <p className="mt-4">
        {t('noAccount')}{' '}
        <Link href="/signup" className="text-primary hover:underline">
          {t('register')}
        </Link>
      </p>
    </div>
  )
}
