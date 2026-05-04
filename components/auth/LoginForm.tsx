'use client'

import { signIn } from '@/lib/actions/auth-actions'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { useRouter } from '@/lib/navigation'

export function LoginForm() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = useTranslations('Auth')

  async function handleSubmit(formData: FormData) {
    setIsLoading(true)
    setError(null)
    try {
      const result = await signIn(formData)
      if (result?.error) {
        setError(result.error)
      } else if (result?.success) {
        toast.success(t('loginSuccess'))
        router.refresh()
        router.push('/')
      }
    } catch (e) {
      setError('An unexpected error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form
      action={handleSubmit}
      className="flex flex-col gap-4 max-w-sm w-full mx-auto p-4 border rounded-lg shadow-sm"
    >
      <h1 className="text-2xl font-bold">{t('loginTitle')}</h1>
      {error && <div className="text-red-500 text-sm">{error}</div>}
      <div className="flex flex-col gap-1">
        <label htmlFor="email">{t('email')}</label>
        <input
          name="email"
          type="email"
          required
          className="border p-2 rounded"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="password">{t('password')}</label>
        <input
          name="password"
          type="password"
          required
          className="border p-2 rounded"
        />
      </div>
      <button
        type="submit"
        disabled={isLoading}
        className="bg-blue-600 text-white p-2 rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {isLoading ? t('loading') || 'Loading...' : t('loginButton')}
      </button>
    </form>
  )
}
