import { createNavigation } from 'next-intl/navigation'
import { defineRouting } from 'next-intl/routing'

export const routing = defineRouting({
  locales: ['en', 'tr'],
  defaultLocale: 'tr',
  localePrefix: 'as-needed',
  localeDetection: false
})

export const { Link, redirect, usePathname, useRouter } =
  createNavigation(routing)
