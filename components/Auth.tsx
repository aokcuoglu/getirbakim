import React, { useState } from 'react'
import { GlassCard } from './Glass'
import { useTranslations } from 'next-intl'

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
        <h2 className="text-3xl font-light text-center mb-2 text-slate-800">
          {isLogin ? t('welcomeBack') : t('createAccount')}
        </h2>
        <p className="text-center text-slate-500 mb-8 font-light">
          {isLogin
            ? t('loginDescription')
            : t('signupDescription')}
        </p>

        {error && (
          <div className="bg-red-50 text-red-500 p-3 rounded mb-4 text-sm text-center border border-red-100">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t('name')}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2 rounded-lg bg-white/50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-light"
                required
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {t('email')}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2 rounded-lg bg-white/50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-light"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              {t('password')}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 rounded-lg bg-white/50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-light"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-6 bg-slate-900 text-white py-2.5 rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {loading ? t('processing') : isLogin ? t('signIn') : t('signUp')}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
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
