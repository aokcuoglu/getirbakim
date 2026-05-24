import { SignUpForm } from '@/components/auth/SignUpForm'
import { Link } from '@/lib/navigation'
import { useTranslations } from 'next-intl'

export default function SignUpPage() {
  const t = useTranslations('Auth')

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2">
      <SignUpForm />
      <p className="mt-4">
        {t('hasAccount')}{' '}
        <Link href="/login" className="text-primary hover:underline">
          {t('loginLink')}
        </Link>
      </p>
    </div>
  )
}
