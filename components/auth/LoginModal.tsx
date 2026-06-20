'use client'

import React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTranslations } from 'next-intl'
import { Clock, Package, Tag, AlertCircle } from 'lucide-react'
import { useState } from 'react'
import { signIn as nextAuthSignIn } from 'next-auth/react'
import { useShop } from '@/components/ShopProvider'
import { Link, useRouter } from '@/lib/navigation'
import { toast } from 'sonner'

interface LoginModalProps {
  children?: React.ReactNode
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onLoginSuccess?: (user?: any) => void
}

export function LoginModal({
  children,
  defaultOpen = false,
  open,
  onOpenChange,
  onLoginSuccess
}: LoginModalProps) {
  const t = useTranslations('LoginModal')
  const router = useRouter()

  // Login State
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // Register State
  const [isLogin, setIsLogin] = useState(true)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [agreeNewsletter, setAgreeNewsletter] = useState(false)
  const [agreeTerms, setAgreeTerms] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [internalOpen, setInternalOpen] = useState(defaultOpen)

  const isControlled = open !== undefined
  const resolvedOpen = isControlled ? open : internalOpen
  const handleOpenChange = (nextOpen: boolean) => {
    if (!isControlled) setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  const handleCloseModal = () => {
    handleOpenChange(false)
  }

  const { setUser, refetchUser } = useShop()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const formData = new FormData()
      formData.append('email', email)
      formData.append('password', password)

      if (!isLogin) {
        if (password !== confirmPassword) {
          setError('Passwords do not match')
          setLoading(false)
          return
        }

        if (!agreeTerms) {
          setError('You must agree to the terms and conditions')
          setLoading(false)
          return
        }

        formData.append('name', `${firstName} ${lastName}`.trim())
        formData.append('confirmPassword', confirmPassword)

        // Import dynamically or at top. I'll stick to import at top.
        // Wait, I need to add the import first.
        const { signUp, signIn } = await import('@/lib/actions/auth-actions')

        const result = await signUp(formData)

        if (result?.error) {
          setError(result.error)
        } else {
          handleCloseModal()

          const successMessage =
            typeof result?.success === 'string'
              ? result.success
              : t('registerSuccess')

          toast.success(successMessage)
          router.refresh()
        }
      } else {
        const result: any = await nextAuthSignIn('credentials', {
          email,
          password,
          redirect: false,
        })

        if (result?.error) {
          setError(t('invalidCredentials') || 'Invalid email or password')
        } else {
          handleCloseModal()
          toast.success(t('loginSuccess'))
          if (onLoginSuccess) await onLoginSuccess()
          await refetchUser()
          router.refresh()
        }
      }
    } catch (err: any) {
      console.error(err)
      setError(err?.message || 'An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const toggleMode = () => {
    setIsLogin(!isLogin)
    setError('')
  }

  return (
    <Dialog open={resolvedOpen} onOpenChange={handleOpenChange}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="p-0 overflow-hidden sm:max-w-[900px] h-auto md:h-[600px] flex gap-0 rounded-xl border-none">
        {/* LEFT SIDE - Benefits (Dark) */}
        <div className="hidden md:flex w-5/12 bg-primary text-primary-foreground p-8 flex-col justify-center relative overflow-hidden">
          {/* Background Image / Texture Effect */}
          <div className="absolute inset-0 z-0 opacity-20">
            <img
              src="https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?q=80&w=1000&auto=format&fit=crop"
              alt="Background"
              className="w-full h-full object-cover"
            />
          </div>

          <div className="relative z-10">
            <h2 className="text-2xl font-bold mb-8">{t('benefitsTitle')}</h2>

            <div className="space-y-6">
              <BenefitItem
                icon={<Clock className="w-6 h-6" />}
                title={t('benefits.fasterCheckout.title')}
                description={t('benefits.fasterCheckout.description')}
              />
              <BenefitItem
                icon={<Package className="w-6 h-6" />}
                title={t('benefits.orderTracking.title')}
                description={t('benefits.orderTracking.description')}
              />
              <BenefitItem
                icon={<Tag className="w-6 h-6" />}
                title={t('benefits.exclusiveOffers.title')}
                description={t('benefits.exclusiveOffers.description')}
              />
            </div>
          </div>
        </div>

        {/* RIGHT SIDE - Form (Light) */}
        <div className="w-full md:w-7/12 bg-background p-8 sm:p-12 flex flex-col justify-center overflow-y-auto max-h-[90vh] md:max-h-full">
          <DialogHeader className="mb-6">
            <DialogTitle className="text-3xl font-bold text-foreground mb-2">
              {isLogin ? t('submit') : t('register')}
            </DialogTitle>
          </DialogHeader>

          {/* Social Logins */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <button className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-md border border-border hover:bg-muted transition-colors text-foreground text-sm font-medium">
              <span className="text-primary font-bold">f</span> Facebook
            </button>
            <button className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-md border border-border hover:bg-muted transition-colors text-foreground text-sm font-medium">
              <span className="text-destructive font-bold">G</span> Google
            </button>
          </div>

          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground font-medium">
                {t('or')}
              </span>
            </div>
          </div>

          {/* Form */}
          <form className="space-y-4" onSubmit={handleSubmit}>
            {error && (
              <div className="flex items-center gap-3 p-4 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg animate-in fade-in slide-in-from-top-2">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <p>{error}</p>
              </div>
            )}

            {!isLogin && (
              <div className="flex gap-4">
                <div className="flex-1 space-y-1">
                  <Input
                    type="text"
                    required
                    placeholder={t('firstName')}
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus-visible:ring-ring/50/20 focus-visible:border-ring transition-all text-sm"
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Input
                    type="text"
                    required
                    placeholder={t('lastName')}
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus-visible:ring-ring/50/20 focus-visible:border-ring transition-all text-sm"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1">
              {!isLogin ? (
                <Input
                  type="email"
                  required
                  placeholder={t('emailAddress')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus-visible:ring-ring/50/20 focus-visible:border-ring transition-all text-sm"
                />
              ) : (
                <>
                  <Label className="text-sm font-medium text-foreground">
                    {t('email')}
                  </Label>
                  <Input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus-visible:ring-ring/50/20 focus-visible:border-ring transition-all text-sm"
                  />
                </>
              )}
            </div>

            {!isLogin ? (
              <div className="flex gap-4">
                <div className="flex-1 space-y-1">
                  <Input
                    type="password"
                    required
                    placeholder={t('passwordPlaceholder')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus-visible:ring-ring/50/20 focus-visible:border-ring transition-all text-sm"
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Input
                    type="password"
                    required
                    placeholder={t('confirmPassword')}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus-visible:ring-ring/50/20 focus-visible:border-ring transition-all text-sm"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <Label className="text-sm font-medium text-foreground">
                  {t('password')}
                </Label>
                <Input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus-visible:ring-ring/50/20 focus-visible:border-ring transition-all text-sm"
                />
              </div>
            )}

            {!isLogin && (
              <div className="space-y-3 pt-2">
                <div className="flex items-start space-x-2">
                  <input
                    type="checkbox"
                    id="newsletter"
                    checked={agreeNewsletter}
                    onChange={(e) => setAgreeNewsletter(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-input text-primary focus-visible:ring-ring/50 cursor-pointer"
                  />
                  <label
                    htmlFor="newsletter"
                    className="text-sm text-muted-foreground leading-tight cursor-pointer select-none"
                  >
                    I agree to receive newsletters, promotions, and other
                    marketing materials via e-mail from{' '}
                    <span className="font-semibold text-foreground">
                      Trodo.com
                    </span>
                  </label>
                </div>
                <div className="flex items-start space-x-2">
                  <input
                    type="checkbox"
                    id="terms"
                    checked={agreeTerms}
                    onChange={(e) => setAgreeTerms(e.target.checked)}
                    required
                    className="mt-1 h-4 w-4 rounded border-input text-primary focus-visible:ring-ring/50 cursor-pointer"
                  />
                  <label
                    htmlFor="terms"
                    className="text-sm text-muted-foreground leading-tight cursor-pointer select-none"
                  >
                    I confirm that I have read, understand, and consent to
                    Trodo.com{' '}
                    <Link
                      href="/uyelik-ve-kullanim-kosullari"
                      className="text-primary hover:underline"
                    >
                      Terms and conditions
                    </Link>{' '}
                    and{' '}
                    <Link
                      href="/gizlilik-politikasi"
                      className="text-primary hover:underline"
                    >
                      Privacy policy
                    </Link>{' '}
                    <span className="text-destructive">*</span>
                  </label>
                </div>
              </div>
            )}

            {isLogin && (
              <div className="flex justify-end">
                <a
                  href="#"
                  className="text-xs text-primary hover:underline font-medium"
                >
                  {t('forgotPassword')}
                </a>
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              size="lg"
              className="w-full py-6 mt-4 font-bold text-base"
            >
              {loading
                ? isLogin
                  ? t('loggingIn') || 'Logging in...'
                  : t('registering') || 'Registering...'
                : isLogin
                  ? t('submit')
                  : t('register')}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            {isLogin ? (
              <>
                {t('noAccount')}{' '}
                <button
                  onClick={toggleMode}
                  className="text-primary hover:underline font-semibold"
                >
                  {t('register')}
                </button>
              </>
            ) : (
              <>
                {t('hasAccount')}{' '}
                <button
                  onClick={toggleMode}
                  className="text-primary hover:underline font-semibold"
                >
                  {t('submit')}
                </button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function BenefitItem({
  icon,
  title,
  description
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="flex gap-4">
      <div className="shrink-0 w-10 h-10 rounded-lg bg-primary-foreground/10 flex items-center justify-center text-primary-foreground/90">
        {icon}
      </div>
      <div>
        <h3 className="font-bold text-primary-foreground text-sm mb-1">{title}</h3>
        <p className="text-xs text-muted-foreground/70 leading-relaxed">{description}</p>
      </div>
    </div>
  )
}
