'use client'

import { useEffect } from 'react'

/**
 * Suppresses specific console warnings that are harmless but noisy:
 * - CSS preload warnings from Next.js
 * - Cookie domain warnings from third-party services (e.g., Cloudflare __cf_bm)
 */
export function ConsoleWarningSuppressor() {
  useEffect(() => {
    // Store original console methods
    const originalWarn = console.warn
    const originalError = console.error

    // Filter out specific warnings
    console.warn = (...args: any[]) => {
      const message = args.join(' ')
      
      // Suppress CSS preload warnings
      if (
        message.includes('preloaded with link preload was not used') ||
        message.includes('preload was not used within a few seconds')
      ) {
        return
      }

      // Suppress cookie domain warnings for Cloudflare and other third-party cookies
      if (
        message.includes('has been rejected for invalid domain') ||
        (message.includes('Cookie') && message.includes('__cf_bm'))
      ) {
        return
      }

      // Call original warn for other messages
      originalWarn.apply(console, args)
    }

    console.error = (...args: any[]) => {
      const message = args.join(' ')
      
      // Suppress cookie domain errors
      if (
        message.includes('has been rejected for invalid domain') ||
        (message.includes('Cookie') && message.includes('__cf_bm'))
      ) {
        return
      }

      // Call original error for other messages
      originalError.apply(console, args)
    }

    // Cleanup: restore original console methods on unmount
    return () => {
      console.warn = originalWarn
      console.error = originalError
    }
  }, [])

  return null
}
