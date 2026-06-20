import '../globals.css'
import type { Metadata } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { ThemeProvider } from 'next-themes'
import { VehicleDataProvider } from '@/lib/context/VehicleDataProvider'
import { ShopProvider } from '@/components/ShopProvider'
import { QueryProvider } from '@/components/QueryProvider'
import { Toaster } from '@/components/ui/sonner'
import { ConsoleWarningSuppressor } from '@/components/ConsoleWarningSuppressor'
import { CookieYesLoader } from '@/components/CookieYesLoader'
import { GlobalCartDrawer } from '@/components/GlobalCartDrawer'
import ChatAssistant from '@/components/ChatAssistant'
import { Inconsolata } from 'next/font/google'
import { GeistMono } from 'geist/font'

const inconsolata = Inconsolata({
  variable: '--font-inconsolata',
  subsets: ['latin', 'latin-ext']
})
import { resolveSiteUrl, isIndexingAllowed } from '@/lib/site-url'

import {
  buildOrganizationJsonLd,
  buildWebSiteJsonLd
} from '@/lib/seo/structured-data'

export const metadata: Metadata = {
  metadataBase: new URL(resolveSiteUrl()),
  title: {
    default: 'GetirBakim - Otomotiv Yedek Parca',
    template: '%s | GetirBakim'
  },
  description: 'Turkiye\'nin otomotiv yedek parca platformu. Binlerce marka ve model icin orijinal ve muadil yedek parca, hizli teslimat ve uygun fiyatlar.',
  ...(isIndexingAllowed() ? {} : {
    robots: {
      index: false,
      follow: false,
      googleBot: {
        index: false,
        follow: false
      }
    }
  })
}

const MESSAGES_CACHE_TTL_MS = 5 * 60 * 1000
type IntlMessages = Awaited<ReturnType<typeof getMessages>>
const messagesCache = new Map<string, { expiresAt: number; messages: IntlMessages }>()

async function getCachedMessages(locale: string): Promise<IntlMessages> {
  const now = Date.now()
  const cached = messagesCache.get(locale)
  if (cached && cached.expiresAt > now) {
    return cached.messages
  }

  const messages = await getMessages({ locale })
  messagesCache.set(locale, {
    expiresAt: now + MESSAGES_CACHE_TTL_MS,
    messages
  })

  return messages
}

export default async function RootLayout({
  children,
  params
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  // Ensure that the incoming `locale` is valid
  const { locale } = await params
  if (!['en', 'tr'].includes(locale)) {
    notFound()
  }

  // Providing all messages to the client
  // side is the easiest way to get started
  const messages = await getCachedMessages(locale)
  const organizationJsonLd = buildOrganizationJsonLd()
  const websiteJsonLd = buildWebSiteJsonLd(locale)

  return (
    <html lang={locale} className={`${inconsolata.variable} ${GeistMono.variable} h-full`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col font-sans">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <CookieYesLoader />
          <ConsoleWarningSuppressor />
          <NextIntlClientProvider locale={locale} messages={messages}>
            <QueryProvider>
              <ShopProvider>
                <VehicleDataProvider>{children}</VehicleDataProvider>
                <ChatAssistant />
                <GlobalCartDrawer />
                <Toaster />
              </ShopProvider>
            </QueryProvider>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
