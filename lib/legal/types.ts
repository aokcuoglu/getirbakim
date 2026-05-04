export const LEGAL_PAGE_KEYS = [
  'distanceSales',
  'preInformation',
  'privacyPolicy',
  'deliveryAndReturns',
  'contact',
  'kvkkDisclosure',
  'cookiePolicy',
  'membershipTerms'
] as const

export type LegalPageKey = (typeof LEGAL_PAGE_KEYS)[number]

export type LegalLocale = 'tr' | 'en'

export const LEGAL_PAGE_SLUGS: Record<LegalPageKey, string> = {
  distanceSales: 'mesafeli-satis-sozlesmesi',
  preInformation: 'on-bilgilendirme-formu',
  privacyPolicy: 'gizlilik-politikasi',
  deliveryAndReturns: 'teslimat-ve-iade',
  contact: 'iletisim',
  kvkkDisclosure: 'kvkk-aydinlatma-metni',
  cookiePolicy: 'cerez-politikasi',
  membershipTerms: 'uyelik-ve-kullanim-kosullari'
}

export interface CompanyProfile {
  brandName: string
  legalName: string
  mersisNo: string
  taxOffice: string
  taxNo: string
  tradeRegistryNo: string
  supportEmail: string
  supportPhone: string
  supportWhatsapp: string
  kepEmail: string
  openAddress: string
  workingHours: string
}

export interface PolicyDefaults {
  cancellationWindowDays: number
  returnWindowDays: number
  standardDeliveryWindow: string
  expressDeliveryWindow: string
  freeShippingThresholdTry: number
}

export interface LegalSection {
  heading: string
  paragraphs: string[]
  bullets?: string[]
}

export interface LegalDocument {
  key: LegalPageKey
  slug: string
  title: string
  summary: string
  lastUpdated: string
  sections: LegalSection[]
}
