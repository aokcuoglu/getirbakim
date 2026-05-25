import { redirect } from 'next/navigation'
import { loginPathWithRedirect } from '@/lib/auth/safe-redirect'
import { db } from '@/lib/db'
import { createClient } from '@/lib/supabase/server'

interface RequireAdminAuthOptions {
  redirectTo?: string
  locale?: string
}

export async function getAdminAuth() {
  let authUser: { id: string; email?: string | undefined } | null = null
  let role: string | null = null

  try {
    const supabase = await createClient()
    const {
      data: { user },
      error
    } = await supabase.auth.getUser()

    if (error || !user) {
      authUser = null
    } else {
      authUser = user

      const dbUser = await db.users.findUnique({
        where: { id: user.id },
        select: { role: true }
      })

      role = dbUser?.role ?? null
    }
  } catch (error) {
    console.error('requireAdminAuth failed', error)
  }

  return authUser ? { user: { id: authUser.id, email: authUser.email, role } } : null
}

export async function requireAdminAuth(options: RequireAdminAuthOptions = {}) {
  const auth = await getAdminAuth()

  if (!auth || auth.user.role !== 'ADMIN') {
    const locale = options.locale ?? 'tr'
    const returnPath = options.redirectTo ?? `/${locale}/admin`
    redirect(loginPathWithRedirect(locale, returnPath))
  }

  return auth
}
