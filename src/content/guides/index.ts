// Guide articles (#646). Pure data (no JSX) so the sitemap, llms.txt and tests can read it; the article bodies live in
// bodies.tsx. The author is the organization (Article JSON-LD), so there is no author field; `reviewedBy` stays empty
// until a named reviewer is approved.
import { legacyCategoryIds } from "@/modules/store/category-tree";

export type Guide = {
  slug: string;
  title: string;
  description: string;
  /** The direct answer, two or three sentences, shown in the "Kısa yanıt" box. */
  answer: string;
  /** YYYY-MM-DD */
  published: string;
  /** YYYY-MM-DD */
  updated: string;
  /** Keys of legacyCategoryIds. */
  categories: string[];
  related?: { title: string; path: string }[];
  sources: { title: string; url?: string }[];
  reviewedBy?: { name: string; role: string };
};

export const guidesPath = "/rehber";

export const guideCategoryLabels: Record<string, string> = {
  "yedek-parca": "Yedek parçalar", fren: "Fren sistemi", filtre: "Filtreler", yag: "Yağlar ve sıvılar", silecek: "Silecekler", aksesuar: "Aksesuar ve ekipman",
};

export const guides: Guide[] = [
  {
    slug: "oem-numarasi-nedir-nasil-bulunur",
    title: "OEM numarası nedir, nasıl bulunur?",
    description: "OEM numarasının ne anlama geldiğini, parça üzerinde ve araç belgelerinde nasıl bulacağını ve doğru parçayı seçerken nasıl kullanacağını öğren.",
    answer: "OEM numarası, parçayı araç veya parça üreticisinin kendi kataloğunda tanımlayan referans numarasıdır. Eski parçanın üzerinden, üretici parça kataloğundan veya ürün sayfasındaki OEM listesinden bulunur. Numara tek başına uyumluluk garantisi vermez; motor kodu ve üretim yılıyla birlikte kontrol edilir.",
    published: "2026-11-17",
    updated: "2026-11-17",
    categories: ["yedek-parca"],
    related: [{ title: "Doğru parçayı nasıl bulursun?", path: "/bilgi/uyumluluk" }, { title: "Sıkça sorulan sorular", path: "/bilgi/yardim" }],
    sources: [
      { title: "Getirbakim: Doğru parçayı nasıl bulursun?", url: "/bilgi/uyumluluk" },
      { title: "Araç sahibinin kullanım kılavuzu ve araç üreticisinin parça kataloğu" },
    ],
  },
  {
    slug: "yag-filtresi-ne-zaman-degisir",
    title: "Yağ filtresi ne zaman değişir?",
    description: "Yağ filtresinin görevini, değişim zamanının neye göre belirlendiğini ve doğru filtreyi seçerken nelere bakacağını öğren.",
    answer: "Yağ filtresi genellikle motor yağıyla birlikte değiştirilir. Değişim zamanı araç üreticisinin bakım planına göre belirlenir; bu aralık motora, yağa ve kullanım koşuluna göre değişir. Plan için kullanım kılavuzuna veya yetkili servise bakılır.",
    published: "2026-11-17",
    updated: "2026-11-17",
    categories: ["filtre", "yag"],
    related: [{ title: "Bakım Robotu", path: "/bakim-robotu" }, { title: "OEM numarası nedir, nasıl bulunur?", path: "/rehber/oem-numarasi-nedir-nasil-bulunur" }],
    sources: [
      { title: "Araç sahibinin kullanım kılavuzu ve araç üreticisinin bakım planı" },
      { title: "Filtre ve motor yağı üreticilerinin ürün bilgileri" },
    ],
  },
];

export const guideBySlug = (slug: string) => guides.find(guide => guide.slug === slug);
export const guidePath = (slug: string) => `${guidesPath}/${slug}`;
export const guidesForCategory = (slug: string) => guides.filter(guide => guide.categories.includes(slug));
export const guideCategoryKeys = Object.keys(legacyCategoryIds);
