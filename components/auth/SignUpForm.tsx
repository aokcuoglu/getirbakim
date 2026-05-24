'use client'

import { signUp } from '@/lib/actions/auth-actions'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

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
      {error && <div className="text-destructive text-sm">{error}</div>}
      {success && <div className="text-success text-sm">{success}</div>}
      <div className="flex flex-col gap-1">
        <Label htmlFor="name">{t('name')}</Label>
        <Input
          id="name"
          name="name"
          type="text"
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="email">{t('email')}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="password">{t('password')}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="confirmPassword">{t('confirmPassword')}</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
        />
      </div>
      <Button
        type="submit"
        disabled={isLoading}
      >
        {isLoading ? t('loading') || 'Loading...' : t('signUpButton')}
      </Button>
    </form>
  )
}
