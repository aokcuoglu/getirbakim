'use client'

import { signUp } from '@/lib/actions/auth-actions'
import { useState } from 'react'
import { useTranslations } from 'next-intl'

export function SignUpForm() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const t = useTranslations('Auth')

  async function handleSubmit(formData: FormData) {
    setIsLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await signUp(formData)
      if (result?.error) {
        setError(result.error)
      } else if (result?.success) {
        setSuccess(result.success)
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
      <h1 className="text-2xl font-bold">{t('signUpTitle')}</h1>
      {error && <div className="text-red-500 text-sm">{error}</div>}
      {success && <div className="text-green-500 text-sm">{success}</div>}
      <div className="flex flex-col gap-1">
        <label htmlFor="name">{t('name')}</label>
        <input
          name="name"
          type="text"
          required
          className="border p-2 rounded"
        />
      </div>
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
      <div className="flex flex-col gap-1">
        <label htmlFor="confirmPassword">{t('confirmPassword')}</label>
        <input
          name="confirmPassword"
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
        {isLoading ? t('loading') || 'Loading...' : t('signUpButton')}
      </button>
    </form>
  )
}
