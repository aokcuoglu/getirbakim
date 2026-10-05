import importedPages from "./legal-pages.json";

export type LegalNode = string | { tag: string; attrs: { href?: string }; children: LegalNode[] };
export type LegalDocument = {
  title: string;
  sourceUrl: string;
  importedAt: string;
  updatedAt: string;
  sourceUpdatedAt?: string;
  description: string;
  sections: { title: string; blocks: LegalNode[] }[];
  company: LegalNode[];
};

export const legalLinks = [
  { slug: "iletisim", title: "İletişim" },
  { slug: "teslimat-ve-iade", title: "Teslimat ve İade" },
  { slug: "mesafeli-satis-sozlesmesi", title: "Mesafeli Satış Sözleşmesi" },
  { slug: "on-bilgilendirme-formu", title: "Ön Bilgilendirme Formu" },
  { slug: "uyelik-ve-kullanim-kosullari", title: "Üyelik ve Kullanım Koşulları" },
  { slug: "gizlilik-politikasi", title: "Gizlilik Politikası" },
  { slug: "kvkk-aydinlatma-metni", title: "KVKK Aydınlatma Metni" },
  { slug: "cerez-politikasi", title: "Çerez Politikası" },
] as const;

export function legalDocument(slug: string): LegalDocument | undefined {
  if (!Object.hasOwn(importedPages, slug)) return undefined;
  return importedPages[slug as keyof typeof importedPages];
}

export function legalTitle(slug: string) {
  return legalLinks.find(link => link.slug === slug)?.title;
}
