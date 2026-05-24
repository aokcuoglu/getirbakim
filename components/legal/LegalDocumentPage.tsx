import type { LegalDocument, LegalLocale } from '@/lib/legal/types'
import { PLACEHOLDER_COMPANY_PROFILE } from '@/lib/legal/content'

interface LegalDocumentPageProps {
  locale: LegalLocale
  document: LegalDocument
}

export function LegalDocumentPage({ locale, document }: LegalDocumentPageProps) {
  const text =
    locale === 'tr'
      ? {
          updatedAt: 'Son guncelleme',
          companyInfo: 'Sirket Bilgileri',
          legalName: 'Unvan',
          address: 'Acik Adres',
          phone: 'Telefon',
          whatsapp: 'WhatsApp',
          email: 'E-posta',
          kep: 'KEP',
          taxInfo: 'Vergi Dairesi / No'
        }
      : {
          updatedAt: 'Last updated',
          companyInfo: 'Company Information',
          legalName: 'Legal Name',
          address: 'Open Address',
          phone: 'Phone',
          whatsapp: 'WhatsApp',
          email: 'Email',
          kep: 'KEP',
          taxInfo: 'Tax Office / Number'
        }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-36">
      <section className="rounded-3xl border border-border bg-background p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {text.updatedAt}: {document.lastUpdated}
        </p>
        <h1 className="mt-3 text-3xl font-bold text-foreground">{document.title}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{document.summary}</p>

        <div className="mt-8 space-y-8">
          {document.sections.map((section) => (
            <article key={section.heading} className="space-y-3">
              <h2 className="text-xl font-semibold text-foreground">{section.heading}</h2>
              {section.paragraphs.map((paragraph, index) => (
                <p key={`${section.heading}-${index}`} className="text-sm leading-7 text-foreground">
                  {paragraph}
                </p>
              ))}
              {section.bullets && section.bullets.length > 0 ? (
                <ul className="list-disc space-y-2 pl-6 text-sm leading-7 text-foreground">
                  {section.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <aside className="mt-6 rounded-3xl border border-border bg-muted p-6">
        <h3 className="text-base font-semibold text-foreground">{text.companyInfo}</h3>
        <div className="mt-4 grid gap-3 text-sm text-foreground md:grid-cols-2">
          <p>
            <span className="font-semibold text-foreground">{text.legalName}: </span>
            {PLACEHOLDER_COMPANY_PROFILE.legalName}
          </p>
          <p>
            <span className="font-semibold text-foreground">{text.phone}: </span>
            {PLACEHOLDER_COMPANY_PROFILE.supportPhone}
          </p>
          <p>
            <span className="font-semibold text-foreground">{text.email}: </span>
            {PLACEHOLDER_COMPANY_PROFILE.supportEmail}
          </p>
          <p>
            <span className="font-semibold text-foreground">{text.whatsapp}: </span>
            {PLACEHOLDER_COMPANY_PROFILE.supportWhatsapp}
          </p>
          <p>
            <span className="font-semibold text-foreground">{text.kep}: </span>
            {PLACEHOLDER_COMPANY_PROFILE.kepEmail}
          </p>
          <p className="md:col-span-2">
            <span className="font-semibold text-foreground">{text.address}: </span>
            {PLACEHOLDER_COMPANY_PROFILE.openAddress}
          </p>
          <p className="md:col-span-2">
            <span className="font-semibold text-foreground">{text.taxInfo}: </span>
            {PLACEHOLDER_COMPANY_PROFILE.taxOffice} / {PLACEHOLDER_COMPANY_PROFILE.taxNo}
          </p>
        </div>
      </aside>
    </main>
  )
}
