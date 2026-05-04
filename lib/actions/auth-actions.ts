'use server'

import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { resolveSiteUrl } from '@/lib/site-url'
import { loginSchema, registerSchema } from '@/lib/validations/auth'

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
    const supabase = await createClient()

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    })

    if (error) {
      console.error('Supabase sign-in error:', error)
      const message =
        error.message && error.message !== '{}'
          ? error.message
          : 'Service currently unavailable. Please try again later (503).'
      return { error: message }
    }

    console.log('User signed in successfully:', email)
    revalidatePath('/', 'layout')
    return { success: true, user: data.user }
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
    const supabase = await createClient()

    // Site URL for email redirection
    const requestHeaders = await headers()
    const siteUrl = resolveSiteUrl({
      headers: requestHeaders,
      preferRequestOrigin: true
    })

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${siteUrl}/auth/callback`,
        data: {
          full_name: name
        }
      }
    })

    if (error) {
      console.error('Supabase sign-up error:', error)
      const message =
        error.message && error.message !== '{}'
          ? error.message
          : 'Service currently unavailable. Please try again later (503).'
      return { error: message }
    }

    if (data.user) {
      try {
        await db.users.upsert({
          where: { id: data.user.id },
          update: {},
          create: {
            id: data.user.id,
            email: email,
            name: name,
            role: 'CUSTOMER',
            created_at: new Date(),
            updated_at: new Date()
          }
        })
        console.log('User synced to DB successfully:', data.user.id)
      } catch (e) {
        console.error('Failed to sync user to DB:', e)
      }
    }

    if (data.session) {
      console.log('Session created immediately for user:', data.user?.id)
      revalidatePath('/', 'layout')
      return {
        success: 'Registration successful. You are now logged in.',
        user: data.user
      }
    }

    console.log('Confirmation email sent to:', email)
    return { success: 'Check your email for the confirmation link.' }
  } catch (e: any) {
    console.error('Sign-up exception:', e)
    return { error: e.message || 'An unexpected error occurred during sign-up' }
  }
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/')
}
