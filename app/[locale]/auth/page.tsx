'use client'

import { useRouter } from 'next/navigation'
import Auth from '@/components/Auth'
import { useTranslations } from 'next-intl'

export default function Page() {
  const router = useRouter()
  const t = useTranslations('AuthPage')

  return (
    <div className="min-h-screen bg-slate-50 relative">
      <div className="absolute top-4 left-4">
        <button
          onClick={() => router.push('/')}
          className="text-slate-500 hover:text-slate-900"
        >
          {t('backToHome')}
        </button>
      </div>
      <Auth onLogin={() => router.push('/')} />
    </div>
  )
}
