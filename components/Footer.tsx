'use client'

import React from 'react'
import {
  ChevronDown,
  Facebook,
  Twitter,
  Instagram,
  Youtube,
  type LucideIcon
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Link } from '@/lib/navigation'
import { Input } from './ui/input'
import { Button } from './ui/button'

// Types
interface SocialLink {
  icon: LucideIcon
  label: string
  href: string
}

interface FooterLink {
  href: string
  labelKey: string
}

// Data
const SOCIAL_LINKS: SocialLink[] = [
  { icon: Facebook, label: 'Facebook', href: '#' },
  { icon: Instagram, label: 'Instagram', href: '#' },
  { icon: Twitter, label: 'Twitter', href: '#' },
  { icon: Youtube, label: 'Youtube', href: '#' }
]

const SHOP_LINKS: FooterLink[] = [
  { href: '/car-parts', labelKey: 'links.carParts' },
  { href: '/oils-and-fluids', labelKey: 'links.oilsFluids' },
  { href: '/wiper-blades', labelKey: 'links.wiperBlades' },
  { href: '/tools', labelKey: 'links.toolsEquipment' },
  {
    href: '/accessories-and-equipment',
    labelKey: 'links.accessories'
  }
]

const COMPANY_LINKS: FooterLink[] = [
  { href: '/iletisim', labelKey: 'links.contact' },
  { href: '/teslimat-ve-iade', labelKey: 'links.deliveryReturns' },
  { href: '/mesafeli-satis-sozlesmesi', labelKey: 'links.distanceSales' },
  { href: '/on-bilgilendirme-formu', labelKey: 'links.preInformation' },
  { href: '/uyelik-ve-kullanim-kosullari', labelKey: 'links.termsConditions' },
  { href: '/gizlilik-politikasi', labelKey: 'links.privacyPolicy' },
  { href: '/kvkk-aydinlatma-metni', labelKey: 'links.kvkkDisclosure' },
  { href: '/cerez-politikasi', labelKey: 'links.cookiePolicy' }
]

const SUPPORT_LINKS: FooterLink[] = [
  { href: '/iletisim', labelKey: 'links.contact' },
  { href: '/teslimat-ve-iade', labelKey: 'links.deliveryReturns' },
  { href: '/orders/lookup', labelKey: 'links.orderTracking' },
  { href: '/cerez-politikasi', labelKey: 'links.cookiePolicy' }
]

const PAYMENT_METHODS = [
  { name: 'Mastercard' },
  { name: 'Visa' },
  { name: 'PayPal' }
]

// Subcomponents
const SocialIcon: React.FC<SocialLink> = ({ icon: Icon, label, href }) => (
  <a
    href={href}
    className="text-slate-300 hover:text-white transition-colors"
    aria-label={label}
  >
    <Icon size={20} />
  </a>
)

const FooterLinkSection: React.FC<{
  title: string
  links: FooterLink[]
  t: (key: string) => string
}> = ({ title, links, t }) => (
  <>
    <details className="group rounded-xl border border-[#263657] bg-[#101a30] px-4 py-3 md:hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between text-white [&::-webkit-details-marker]:hidden">
        <h4 className="text-[15px] font-semibold tracking-tight text-slate-100">
          {title}
        </h4>
        <ChevronDown className="h-4 w-4 text-slate-300 transition-transform group-open:rotate-180" />
      </summary>
      <ul className="mt-3 space-y-2.5 text-sm text-slate-300">
        {links.map((link) => (
          <li key={link.labelKey}>
            <Link
              href={link.href}
              prefetch={false}
              className="transition-colors hover:text-white"
            >
              {t(link.labelKey)}
            </Link>
          </li>
        ))}
      </ul>
    </details>

    <div className="hidden rounded-2xl border border-[#22324d] bg-[#0e1830]/70 p-5 md:block">
      <h4 className="text-[15px] font-semibold tracking-tight text-slate-100">
        {title}
      </h4>
      <ul className="mt-4 space-y-2.5 text-sm text-slate-300">
        {links.map((link) => (
          <li key={link.labelKey}>
            <Link
              href={link.href}
              prefetch={false}
              className="inline-flex transition-colors hover:text-white"
            >
              {t(link.labelKey)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  </>
)

const PaymentIcon: React.FC<{ name: string }> = ({ name }) => (
  <div className="rounded-full border border-[#2d4065] bg-[#16233f] px-2.5 py-1 text-[10px] font-semibold text-slate-200">
    {name}
  </div>
)

interface FooterProps {
  onAdminClick?: () => void
}

const Footer: React.FC<FooterProps> = () => {
  const t = useTranslations('Footer')
  const currentYear = new Date().getFullYear()
  const buildVersionRaw = process.env.NEXT_PUBLIC_BUILD_VERSION
  const buildVersion = buildVersionRaw ? buildVersionRaw.slice(0, 7) : 'local'

  const openCookieSettings = () => {
    if (typeof window === 'undefined') return
    const revisit = (window as Window & { revisitCkyConsent?: () => void })
      .revisitCkyConsent
    if (typeof revisit === 'function') {
      revisit()
      return
    }

    window.location.href = '/cerez-politikasi'
  }

  return (
    <footer className="border-t border-[#25344f] bg-[linear-gradient(180deg,#0a1020_0%,#0d1730_45%,#0a1428_100%)] text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 md:py-10">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)] lg:items-start">
          <div className="rounded-2xl border border-[#253652] bg-[#0f1a31] p-5">
            <Link href="/" prefetch={false} className="mb-2.5 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-white text-base font-bold text-slate-900">
                G
              </div>
              <span className="text-lg font-bold tracking-tight text-white">
                GetirBakim
              </span>
            </Link>
            <p className="max-w-2xl text-sm leading-6 text-slate-200">
              {t('brandDescription')}
            </p>
            <div className="mt-3 flex gap-4">
              {SOCIAL_LINKS.map((social) => (
                <SocialIcon key={social.label} {...social} />
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[#253652] bg-[#0f1a31] p-5">
            <h4 className="mb-2 text-base font-semibold text-white">
              {t('stayUpdated')}
            </h4>
            <p className="mb-3 text-sm leading-6 text-slate-200">
              {t('subscribeText')}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="email"
                placeholder={t('emailPlaceholder')}
                className="h-10 border-[#2a3c5d] bg-[#0b1428] text-slate-100 placeholder:text-slate-400 focus-visible:ring-[#3b5d94]"
              />
              <Button
                variant="default"
                size="sm"
                className="h-10 rounded-md border border-blue-400/40 bg-blue-500 px-4 text-white hover:bg-blue-400 sm:shrink-0"
              >
                {t('join')}
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3 md:gap-4">
          <FooterLinkSection title={t('shop')} links={SHOP_LINKS} t={t} />
          <FooterLinkSection title={t('company')} links={COMPANY_LINKS} t={t} />
          <FooterLinkSection title={t('support')} links={SUPPORT_LINKS} t={t} />
        </div>

        {/* Bottom Bar */}
        <div className="mt-5 flex flex-col items-start justify-between gap-3 border-t border-[#263957] pt-5 md:flex-row md:items-center">
          <div className="space-y-1">
            <p className="text-xs text-slate-300">
              © {currentYear} Ergul Enerji San Tic Ltd Sti. {t('rightsReserved')}
            </p>
            <p className="text-[11px] text-slate-400">
              {t('buildVersionLabel')}: {buildVersion}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-slate-300">
            <button
              type="button"
              onClick={openCookieSettings}
              className="text-xs underline-offset-4 hover:underline hover:text-white"
            >
              {t('cookieSettings')}
            </button>
            {PAYMENT_METHODS.map((payment) => (
              <PaymentIcon key={payment.name} {...payment} />
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}

export default Footer
