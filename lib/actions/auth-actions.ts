'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { loginSchema, registerSchema } from '@/lib/validations/auth'
import { signIn as nextAuthSignIn, signOut as nextAuthSignOut } from '@/lib/auth/config'
import { hash } from 'bcryptjs'
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
