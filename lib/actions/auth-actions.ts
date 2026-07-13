'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { loginSchema, registerSchema, changePasswordSchema } from '@/lib/validations/auth'
import { signIn as nextAuthSignIn, signOut as nextAuthSignOut, auth } from '@/lib/auth/config'
import { hash, compare } from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'

export async function signIn(formData: FormData) {
  try {
    const rawData = Object.fromEntries(formData.entries())
    const validatedFields = loginSchema.safeParse(rawData)

    if (!validatedFields.success) {
      return {
        error: 'Invalid fields',
        fieldErrors: validatedFields.error.flatten().fieldErrors
      }
    }

    const { email, password } = validatedFields.data

    const user = await db.users.findUnique({
      where: { email },
      select: { id: true, name: true, email: true, role: true, image: true, password_hash: true },
    })

    if (!user || !user.password_hash) {
      return { error: 'Invalid email or password' }
    }

    const { compare } = await import('bcryptjs')
    const isValid = await compare(password, user.password_hash)
    if (!isValid) {
      return { error: 'Invalid email or password' }
    }

    await nextAuthSignIn('credentials', {
      email,
      password,
      redirect: false,
    })

    console.log('User signed in successfully:', email)
    revalidatePath('/', 'layout')
    return {
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        image: user.image,
      },
    }
  } catch (e: any) {
    console.error('Sign-in exception:', e)
    return { error: e.message || 'An unexpected error occurred during sign-in' }
  }
}

export async function signUp(formData: FormData) {
  try {
    const rawData = Object.fromEntries(formData.entries())
    const validatedFields = registerSchema.safeParse(rawData)

    if (!validatedFields.success) {
      return {
        error: 'Invalid fields',
        fieldErrors: validatedFields.error.flatten().fieldErrors
      }
    }

    const { email, password, name } = validatedFields.data
    const passwordHash = await hash(password, 12)

    const existingUser = await db.users.findUnique({
      where: { email },
      select: { id: true },
    })

    if (existingUser) {
      return { error: 'An account with this email already exists' }
    }

    const id = uuidv4()
    const now = new Date()

    await db.users.create({
      data: {
        id,
        email,
        name,
        password_hash: passwordHash,
        email_verified: true,
        role: 'CUSTOMER',
        created_at: now,
        updated_at: now,
      },
    })

    console.log('User created successfully:', id)

    await nextAuthSignIn('credentials', {
      email,
      password,
      redirect: false,
    })

    revalidatePath('/', 'layout')
    return { success: 'Registration successful. You are now logged in.' }
  } catch (e: any) {
    console.error('Sign-up exception:', e)
    return { error: e.message || 'An unexpected error occurred during sign-up' }
  }
}

export async function signOut() {
  await nextAuthSignOut()
  revalidatePath('/', 'layout')
  redirect('/')
}

/**
 * Change the signed-in user's password.
 * Returns a stable error `code` (mapped to a localized message client-side)
 * or `{ success: true }`. Never surfaces which specific check failed beyond
 * the current-password verification, to avoid leaking account state.
 */
export async function changePassword(input: {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}): Promise<{ success?: true; error?: string }> {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'unauthenticated' }
    }

    const parsed = changePasswordSchema.safeParse(input)
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors
      if (fieldErrors.confirmPassword?.length) return { error: 'mismatch' }
      if (fieldErrors.newPassword?.length) return { error: 'weak' }
      return { error: 'invalid_fields' }
    }

    const { currentPassword, newPassword } = parsed.data

    const user = await db.users.findUnique({
      where: { id: session.user.id },
      select: { id: true, password_hash: true },
    })

    if (!user?.password_hash) {
      return { error: 'invalid_current' }
    }

    const currentValid = await compare(currentPassword, user.password_hash)
    if (!currentValid) {
      return { error: 'invalid_current' }
    }

    const reused = await compare(newPassword, user.password_hash)
    if (reused) {
      return { error: 'same_password' }
    }

    const newHash = await hash(newPassword, 12)
    await db.users.update({
      where: { id: user.id },
      data: { password_hash: newHash, updated_at: new Date() },
    })

    console.log('Password changed for user:', user.id)
    return { success: true }
  } catch (e: any) {
    console.error('Change-password exception:', e)
    return { error: 'unknown' }
  }
}
