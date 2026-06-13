import { auth } from '@/lib/auth/config'
import { db } from '@/lib/db'
import { redirect } from 'next/navigation'

export async function getServerSession() {
  const session = await auth()
  return session
}

export async function getCurrentUser() {
  const session = await auth()
  if (!session?.user?.id) return null

  const dbUser = await db.users.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, role: true, image: true },
  })

  return dbUser
}

export async function requireAuth() {
  const session = await auth()
  if (!session?.user?.id) {
    redirect('/login')
  }
  return session
}

export async function getAdminAuth() {
  const session = await auth()
  if (!session?.user?.id) return null

  const dbUser = await db.users.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  })

  return session.user
    ? { user: { id: session.user.id, email: session.user.email, role: dbUser?.role ?? null } }
    : null
}

export async function requireAdminAuth(redirectTo = '/') {
  const session = await auth()
  if (!session?.user?.id) {
    redirect('/login')
  }

  const dbUser = await db.users.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  })

  if (dbUser?.role !== 'ADMIN') {
    redirect(redirectTo)
  }

  return { user: { id: session.user.id, email: session.user.email, role: dbUser.role } }
}
