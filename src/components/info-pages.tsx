import Link from "next/link";
import { LegalBlocks, legalBodyClass } from "@/components/legal-page";
import { JsonLd } from "@/components/json-ld";
import { faqGroups } from "@/content/faq";
import { aboutContact, aboutIntro, aboutSections } from "@/content/about";
import { legalDocument } from "@/content/legal";
import { faqJsonLd } from "@/modules/seo/structured-data";
import { siteName } from "@/lib/site";

const h2 = "scroll-mt-6 mt-9 mb-3 text-[22px] leading-8 font-semibold tracking-[-.4px]";
const text = "mb-4 text-sm leading-[1.9] text-muted-foreground";
const link = "text-primary underline underline-offset-3";
const anchor = `${link} inline-block py-2`;

export function Paragraphs({ items }: { items: string[] }) {
  return <>{items.map(item => <p key={item} className={text}>{item}</p>)}</>;
}

/** Support lines of the contact page of the legal set, shared by the FAQ and the about page. */
function ContactLines() {
  return <>Telefon: <a className={link} href={`tel:${aboutContact.phoneHref}`}>{aboutContact.phone}</a> · E-posta: <a className={link} href={`mailto:${aboutContact.email}`}>{aboutContact.email}</a> · Çalışma saatleri: {aboutContact.hours}</>;
}

/** The help page: every answer is in the HTML (no accordion) and the FAQPage markup repeats the same strings. */
export function FaqContent() {
  return <>
    <JsonLd data={faqJsonLd(faqGroups.flatMap(group => group.items))}/>
    <nav aria-label="Bu sayfada" className="mb-8 rounded-lg border border-border p-5">
      <h2 className="mb-2 text-base leading-6 font-semibold">Bu sayfada</h2>
      <ul className="list-disc pl-6 text-sm leading-[1.9]">{faqGroups.map(group => <li key={group.id}><a className={anchor} href={`#${group.id}`}>{group.title}</a></li>)}</ul>
    </nav>
    {faqGroups.map(group => <section key={group.id} aria-labelledby={group.id}>
      <h2 id={group.id} className={h2}>{group.title}</h2>
      {group.items.map((item, index) => {
        return <div key={`${group.id}-${index}`} className="mb-6">
          <h3 className="mb-2 text-base leading-6 font-semibold">{item.question}</h3>
          <p className={`${text} mb-2`}>{item.answer}</p>
          {item.links?.length ? <p className="text-sm leading-6">{item.links.map((entry, i) => <span key={entry.href}>{i > 0 && " · "}<Link className={anchor} href={entry.href}>{entry.title}</Link></span>)}</p> : null}
        </div>;
      })}
    </section>)}
    <section aria-labelledby="destek" className="mt-10 mb-8 rounded-lg border border-border bg-[#f7f8fa] p-5">
      <h2 id="destek" className="mb-2 text-base leading-6 font-semibold">Aradığın yanıtı bulamadın mı?</h2>
      <p className="text-sm leading-[1.9] text-muted-foreground"><ContactLines/></p>
    </section>
  </>;
}

/** The about page. The company registry block is the contact page's own, so the figures exist in one place. */
export function AboutContent() {
  const company = legalDocument("iletisim")!.company;
  return <>
    <Paragraphs items={aboutIntro}/>
    <section aria-labelledby="isletme"><h2 id="isletme" className={h2}>{siteName}’i kim işletiyor?</h2>
      <div className={`${legalBodyClass} [&_p]:text-sm [&_p]:leading-[1.9] [&_p]:mb-1 [&_a]:text-primary [&_a]:underline [&_a]:wrap-anywhere`}><LegalBlocks blocks={company}/></div>
    </section>
    <section aria-labelledby="iletisim"><h2 id="iletisim" className={h2}>Bize nasıl ulaşırsın?</h2>
      <p className={text}><ContactLines/></p>
      <Paragraphs items={aboutSections.contact}/>
      <p className={text}>Tüm iletişim kanalları için <Link className={link} href="/iletisim">İletişim</Link> sayfasına bak.</p>
    </section>
    <section aria-labelledby="deneyim"><h2 id="deneyim" className={h2}>Deneyimimiz</h2><Paragraphs items={aboutSections.experience}/></section>
    <section aria-labelledby="tedarik"><h2 id="tedarik" className={h2}>Ürünleri nereden tedarik ediyoruz?</h2><Paragraphs items={aboutSections.supply}/></section>
    <section aria-labelledby="uyumluluk"><h2 id="uyumluluk" className={h2}>Uyumluluğu nasıl doğruluyoruz?</h2><Paragraphs items={aboutSections.compatibility}/>
      <p className={text}><Link className={link} href="/bilgi/uyumluluk">Doğru parçayı nasıl bulursun?</Link> · <Link className={link} href="/rehber/oem-numarasi-nedir-nasil-bulunur">OEM numarası nedir, nasıl bulunur?</Link></p>
    </section>
    <section aria-labelledby="iade"><h2 id="iade" className={h2}>İade ve teslimat</h2>
      <p className={text}>Teslimat süreleri, cayma hakkı ve geri ödeme koşulları <Link className={link} href="/teslimat-ve-iade">Teslimat ve İade</Link> sayfasında açıklanmıştır. Sık sorulan soruların yanıtları için <Link className={link} href="/bilgi/yardim">Sıkça sorulan sorular</Link> sayfasına bak.</p>
    </section>
  </>;
}
