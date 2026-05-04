'use client'

import { useState, useCallback } from 'react'

type ToastVariant = 'default' | 'destructive' | 'success'

interface Toast {
  id: string
  title?: string
  description?: string
  variant?: ToastVariant
}

interface ToastOptions {
  title?: string
  description?: string
  variant?: ToastVariant
}

// Simple toast hook - in production use sonner or shadcn/ui toast
export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback(
    ({ title, description, variant = 'default' }: ToastOptions) => {
      const id = Math.random().toString(36).substring(7)
      const newToast: Toast = { id, title, description, variant }

      setToasts((prev) => [...prev, newToast])

      // Auto dismiss after 3s
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, 3000)

      // For now, also log to console since we don't have a toast UI
      if (variant === 'destructive') {
        console.error(`[Toast] ${title}: ${description}`)
      } else {
        console.log(`[Toast] ${title}: ${description}`)
      }
    },
    []
  )

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return { toast, toasts, dismiss }
}
