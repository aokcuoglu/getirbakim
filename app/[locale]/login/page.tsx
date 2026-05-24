import { LoginForm } from '@/components/auth/LoginForm'
import { Link } from '@/lib/navigation'
import { useTranslations } from 'next-intl'

export default function LoginPage() {
  const t = useTranslations('Auth')

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2">
      <LoginForm />
      <p className="mt-4">
        {t('noAccount')}{' '}
        <Link href="/signup" className="text-primary hover:underline">
          {t('register')}
        </Link>
      </p>
    </div>
  )
}
