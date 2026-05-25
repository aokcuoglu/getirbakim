'use client'

import { signIn } from '@/lib/actions/auth-actions'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { useRouter } from '@/lib/navigation'
import { safeRedirectPath } from '@/lib/auth/safe-redirect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
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
        router.push(safeRedirectPath(redirectTo, '/'))
      }
    } catch (e: any) {
      setError(e?.message || 'An unexpected error occurred')
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
      {error && <div className="text-destructive text-sm">{error}</div>}
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
      <Button
        type="submit"
        disabled={isLoading}
      >
        {isLoading ? t('loading') || 'Loading...' : t('loginButton')}
      </Button>
    </form>
  )
}
