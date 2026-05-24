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

interface SocialLink {
  icon: LucideIcon
  label: string
  href: string
}

interface FooterLink {
  href: string
  labelKey: string
}

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
  { href: '/accessories-and-equipment', labelKey: 'links.accessories' }
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

const PAYMENT_METHODS = [{ name: 'Mastercard' }, { name: 'Visa' }, { name: 'PayPal' }]

const SocialIcon: React.FC<SocialLink> = ({ icon: Icon, label, href }) => (
  <a
    href={href}
    className="text-footer-muted transition-colors hover:text-footer-foreground"
    aria-label={label}
  >
    <Icon className="size-5" />
  </a>
)

const FooterLinkSection: React.FC<{
  title: string
  links: FooterLink[]
  t: (key: string) => string
}> = ({ title, links, t }) => (
  <>
    <details className="group rounded-xl border border-footer-border bg-footer/80 px-4 py-3 md:hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between text-footer-foreground [&::-webkit-details-marker]:hidden">
        <h4 className="text-sm font-semibold tracking-tight">{title}</h4>
        <ChevronDown className="size-4 text-footer-muted transition-transform group-open:rotate-180" />
      </summary>
      <ul className="mt-3 space-y-2.5 text-sm text-footer-muted">
        {links.map((link) => (
          <li key={link.labelKey}>
            <Link
              href={link.href}
              prefetch={false}
              className="transition-colors hover:text-footer-foreground"
            >
              {t(link.labelKey)}
            </Link>
          </li>
        ))}
      </ul>
    </details>

    <div className="hidden rounded-xl border border-footer-border bg-footer/70 p-5 md:block">
      <h4 className="text-sm font-semibold tracking-tight text-footer-foreground">
        {title}
      </h4>
      <ul className="mt-4 space-y-2.5 text-sm text-footer-muted">
        {links.map((link) => (
          <li key={link.labelKey}>
            <Link
              href={link.href}
              prefetch={false}
              className="inline-flex transition-colors hover:text-footer-foreground"
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
  <div className="rounded-full border border-footer-border bg-footer/90 px-2.5 py-1 text-[10px] font-semibold text-footer-foreground">
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
    <footer className="border-t border-footer-border bg-footer text-footer-foreground">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 md:py-10">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)] lg:items-start">
          <div className="rounded-xl border border-footer-border bg-footer/90 p-5">
            <Link href="/" prefetch={false} className="mb-2.5 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-md bg-primary text-base font-bold text-primary-foreground">
                G
              </div>
              <span className="text-lg font-bold tracking-tight">GetirBakim</span>
            </Link>
            <p className="max-w-2xl text-sm leading-6 text-footer-muted">
              {t('brandDescription')}
            </p>
            <div className="mt-3 flex gap-4">
              {SOCIAL_LINKS.map((social) => (
                <SocialIcon key={social.label} {...social} />
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-footer-border bg-footer/90 p-5">
            <h4 className="mb-2 text-base font-semibold">{t('stayUpdated')}</h4>
            <p className="mb-3 text-sm leading-6 text-footer-muted">
              {t('subscribeText')}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="email"
                placeholder={t('emailPlaceholder')}
                className="border-footer-border bg-background/10 text-footer-foreground placeholder:text-footer-muted"
              />
              <Button size="sm" className="sm:shrink-0">
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

        <div className="mt-5 flex flex-col items-start justify-between gap-3 border-t border-footer-border pt-5 md:flex-row md:items-center">
          <div className="space-y-1">
            <p className="text-xs text-footer-muted">
              © {currentYear} Ergul Enerji San Tic Ltd Sti. {t('rightsReserved')}
            </p>
            <p className="text-[11px] text-footer-muted/80">
              {t('buildVersionLabel')}: {buildVersion}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-footer-muted">
            <Button
              type="button"
              variant="link"
              onClick={openCookieSettings}
              className="h-auto p-0 text-xs text-footer-muted hover:text-footer-foreground"
            >
              {t('cookieSettings')}
            </Button>
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
