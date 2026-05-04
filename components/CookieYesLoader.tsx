'use client'

import { useEffect } from 'react'

const FALLBACK_COOKIEYES_CLIENT_ID = 'af79e12b2fa75e972a5c6f782a7a281d'
const COOKIEYES_CLIENT_ID =
  process.env.NEXT_PUBLIC_COOKIEYES_CLIENT_ID?.trim() || FALLBACK_COOKIEYES_CLIENT_ID
const COOKIEYES_ENABLED = process.env.NEXT_PUBLIC_ENABLE_COOKIEYES !== 'false'
const COOKIEYES_ALLOWED_HOSTS = (process.env.NEXT_PUBLIC_COOKIEYES_ALLOWED_HOSTS ?? '')
  .split(',')
  .map(normalizeHost)
  .filter(Boolean)

function normalizeHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '')
}

export function CookieYesLoader() {
  useEffect(() => {
    const clientId = COOKIEYES_CLIENT_ID
    if (!COOKIEYES_ENABLED || !clientId) {
      return
    }

    const currentHost = normalizeHost(window.location.hostname)
    if (COOKIEYES_ALLOWED_HOSTS.length > 0) {
      if (!COOKIEYES_ALLOWED_HOSTS.includes(currentHost)) {
        return
      }
    } else if (process.env.NODE_ENV !== 'production') {
      // Avoid CookieYes host-validation errors during local development by default.
      return
    }

    if (document.getElementById('cookieyes')) {
      return
    }

    const script = document.createElement('script')
    script.id = 'cookieyes'
    script.src = `https://cdn-cookieyes.com/client_data/${clientId}/script.js`
    script.async = true
    document.head.appendChild(script)
  }, [])

  return null
}
