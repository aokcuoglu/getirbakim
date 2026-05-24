import React, { useState } from 'react'
import { GlassCard } from './Glass'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface AuthProps {
  onLogin: () => void
}

const Auth: React.FC<AuthProps> = ({ onLogin }) => {
  const t = useTranslations('AuthPage')
  const [isLogin, setIsLogin] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const formData = new FormData()
      formData.append('email', email)
      formData.append('password', password)

      if (isLogin) {
        const { signIn } = await import('@/lib/actions/auth-actions')
        const result: any = await signIn(formData)

        if (result?.error) {
          setError(result.error)
        } else {
          onLogin()
        }
      } else {
        formData.append('name', name)
        formData.append('confirmPassword', password) // Use password as confirm password for this simplified form
        const { signUp } = await import('@/lib/actions/auth-actions')

        const result = await signUp(formData)

        if (result?.error) {
          setError(result.error)
        } else {
          // Success
          if (typeof result.success === 'string') {
            setError(result.success) // Show success message in the error box for now
          } else {
            setIsLogin(true)
          }
        }
      }
    } catch (err) {
      console.error(err)
      setError(t('genericError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[80vh]">
      <GlassCard className="w-full max-w-md p-8 animate-in zoom-in duration-300">
        <h2 className="text-3xl font-light text-center mb-2 text-foreground">
          {isLogin ? t('welcomeBack') : t('createAccount')}
        </h2>
        <p className="text-center text-muted-foreground mb-8 font-light">
          {isLogin
            ? t('loginDescription')
            : t('signupDescription')}
        </p>

        {error && (
          <div className="bg-destructive/10 text-destructive p-3 rounded mb-4 text-sm text-center border border-red-100">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div>
              <Label className="mb-1">{t('name')}</Label>
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-background/50 font-light"
                required
              />
            </div>
          )}
          <div>
            <Label className="mb-1">{t('email')}</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-background/50 font-light"
              required
            />
          </div>
          <div>
            <Label className="mb-1">{t('password')}</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-background/50 font-light"
              required
            />
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full mt-6"
          >
            {loading ? t('processing') : isLogin ? t('signIn') : t('signUp')}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {isLogin
              ? t('dontHaveAccount')
              : t('alreadyHaveAccount')}
          </button>
        </div>
      </GlassCard>
    </div>
  )
}

export default Auth
