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
  {
    slug: "fren-balatasi-ne-zaman-degisir-nasil-secilir",
    title: "Fren balatası ne zaman değişir, nasıl seçilir?",
    description: "Fren balatasının değişim zamanını gösteren işaretleri, balata ile disk ilişkisini ve aracına uygun balatayı nasıl seçeceğini öğren.",
    answer: "Fren balatası, kalınlığı üreticinin belirlediği alt sınıra indiğinde değiştirilir; aşınma uyarı lambası, metalik sürtünme sesi veya uzayan fren mesafesi bunun işaretidir. Balata her zaman aynı akstaki iki teker için birlikte değiştirilir. Doğru balata OEM numarası, aks (ön/arka) ve fren sistemi bilgisiyle seçilir.",
    published: "2026-11-21",
    updated: "2026-11-21",
    categories: ["fren"],
    related: [{ title: "OEM numarası nedir, nasıl bulunur?", path: "/rehber/oem-numarasi-nedir-nasil-bulunur" }, { title: "Doğru parçayı nasıl bulursun?", path: "/bilgi/uyumluluk" }],
    sources: [
      { title: "Araç sahibinin kullanım kılavuzu ve araç üreticisinin bakım planı" },
      { title: "Fren balatası ve disk üreticilerinin montaj ve ürün bilgileri" },
    ],
  },
  {
    slug: "hava-filtresi-ve-polen-filtresi-farki",
    title: "Hava filtresi ile polen filtresi arasındaki fark nedir?",
    description: "Motor hava filtresi ile polen (kabin) filtresinin görevlerini, nerede durduklarını, ne zaman değiştiklerini ve nasıl seçildiklerini öğren.",
    answer: "Hava filtresi motorun yanma için emdiği havayı, polen filtresi ise kabine giren havayı temizler. İkisi farklı yerlerde durur ve birbirinin yerine kullanılamaz. Değişim aralıkları araç üreticisinin bakım planında ayrı ayrı yazar; tozlu ortamda daha sık kontrol edilir.",
    published: "2026-11-21",
    updated: "2026-11-21",
    categories: ["filtre"],
    related: [{ title: "Yağ filtresi ne zaman değişir?", path: "/rehber/yag-filtresi-ne-zaman-degisir" }, { title: "Bakım Robotu", path: "/bakim-robotu" }],
    sources: [
      { title: "Araç sahibinin kullanım kılavuzu ve araç üreticisinin bakım planı" },
      { title: "Filtre üreticilerinin ürün bilgileri" },
    ],
  },
  {
    slug: "motor-yagi-nasil-secilir",
    title: "Motor yağı nasıl seçilir?",
    description: "Motor yağı seçerken viskozite (ör. 5W-30), ACEA/API sınıfı ve araç üreticisi onayının ne anlama geldiğini ve hangisinin öncelikli olduğunu öğren.",
    answer: "Motor yağı, araç üreticisinin kullanım kılavuzunda istediği viskozite ve onaya göre seçilir. 5W-30 gibi viskozite değeri yağın soğukta ve sıcakta akışkanlığını, ACEA/API sınıfı genel kalite seviyesini, üretici onayı (ör. VW 504 00, MB 229.51) ise o motor için test edildiğini gösterir. Onay varsa ilk bakılacak bilgi odur.",
    published: "2026-11-21",
    updated: "2026-11-21",
    categories: ["yag"],
    related: [{ title: "Yağ filtresi ne zaman değişir?", path: "/rehber/yag-filtresi-ne-zaman-degisir" }, { title: "Bakım Robotu", path: "/bakim-robotu" }],
    sources: [
      { title: "SAE J300 motor yağı viskozite sınıflandırması" },
      { title: "ACEA Avrupa motor yağı sınıfları ve API servis kategorileri" },
      { title: "Araç sahibinin kullanım kılavuzu (yağ özellikleri bölümü)" },
    ],
  },
  {
    slug: "aku-ne-zaman-degisir-hangi-aku-uyar",
    title: "Akü ne zaman değişir, hangi akü uyar?",
    description: "Akünün zayıfladığını gösteren işaretleri ve aracına uygun aküyü kapasite (Ah), marş akımı (A), ölçü, kutup yönü ve teknoloji (EFB/AGM) ile nasıl seçeceğini öğren.",
    answer: "Akü, marş zorlanmaya başladığında, test cihazında kapasitesini kaybettiği görüldüğünde veya araç uzun süre bekleyince çalışmadığında değiştirilir. Yeni akü; kapasite (Ah), soğuk marş akımı (A), kutu ölçüsü ve kutup yönü eskisiyle uyumlu olacak şekilde seçilir. Start-stop sistemli araçlarda üreticinin istediği EFB veya AGM teknolojisi kullanılır.",
    published: "2026-11-21",
    updated: "2026-11-21",
    categories: ["yedek-parca"],
    related: [{ title: "Doğru parçayı nasıl bulursun?", path: "/bilgi/uyumluluk" }],
    sources: [
      { title: "EN 50342 kurşun asit marş aküleri standardı (kapasite ve soğuk marş akımı)" },
      { title: "Araç sahibinin kullanım kılavuzu ve akü üreticilerinin uygulama listeleri" },
    ],
  },
  {
    slug: "triger-seti-ne-zaman-degisir",
    title: "Triger seti ne zaman değişir?",
    description: "Triger kayışının görevini, değişim zamanının kilometre ve süreyle nasıl belirlendiğini, sette neler bulunduğunu ve zincirli motorların farkını öğren.",
    answer: "Triger kayışı, araç üreticisinin bakım planında yazan kilometre veya süre sınırından hangisi önce dolarsa o zaman değiştirilir. Kayış koptuğunda birçok motorda ciddi hasar oluşur, bu yüzden aralık geciktirilmez. Kayışla birlikte gergi ve avara rulmanları, planda yazıyorsa devirdaim pompası da değiştirilir.",
    published: "2026-11-21",
    updated: "2026-11-21",
    categories: ["yedek-parca"],
    related: [{ title: "OEM numarası nedir, nasıl bulunur?", path: "/rehber/oem-numarasi-nedir-nasil-bulunur" }, { title: "Doğru parçayı nasıl bulursun?", path: "/bilgi/uyumluluk" }],
    sources: [
      { title: "Araç üreticisinin bakım planı" },
      { title: "Triger seti üreticilerinin montaj talimatları" },
    ],
  },
  {
    slug: "silecek-supurgesi-olcusu-nasil-bulunur",
    title: "Silecek süpürgesi ölçüsü nasıl bulunur?",
    description: "Silecek süpürgesinin uzunluğunu, bağlantı tipini ve sürücü-yolcu tarafı farkını nasıl belirleyeceğini, ne zaman değiştirmen gerektiğini öğren.",
    answer: "Silecek ölçüsü, süpürgenin lastik uzunluğunun milimetre (veya inç) olarak ölçülmesiyle ya da araç modeline göre üretici uygulama listesinden bulunur. Sürücü ve yolcu tarafı çoğu araçta farklı uzunluktadır. Uzunluk kadar kol bağlantı tipi de uymalıdır; süpürge iz bırakıyor, sekiyor veya ses yapıyorsa değiştirilir.",
    published: "2026-11-21",
    updated: "2026-11-21",
    categories: ["silecek"],
    related: [{ title: "Doğru parçayı nasıl bulursun?", path: "/bilgi/uyumluluk" }],
    sources: [
      { title: "Silecek üreticilerinin araç uygulama listeleri ve montaj bilgileri" },
      { title: "Araç sahibinin kullanım kılavuzu" },
    ],
  },
  {
    slug: "antifriz-rengi-onemli-mi",
    title: "Antifriz rengi önemli mi?",
    description: "Antifrizi seçerken rengin neden yeterli olmadığını, teknoloji ve üretici onayının (ör. G12, G13) ne anlama geldiğini ve antifrizlerin karıştırılıp karıştırılamayacağını öğren.",
    answer: "Hayır, renk tek başına güvenilir bir ölçüt değildir. Aynı renkte farklı kimyalar, farklı renkte aynı kimya bulunabilir. Antifriz, araç üreticisinin istediği özellik veya onaya (ör. VW G12evo, G13, MB 325.x) göre seçilir; emin değilsen farklı antifrizleri karıştırma.",
    published: "2026-11-21",
    updated: "2026-11-21",
    categories: ["yag"],
    related: [{ title: "Motor yağı nasıl seçilir?", path: "/rehber/motor-yagi-nasil-secilir" }],
    sources: [
      { title: "Araç sahibinin kullanım kılavuzu (soğutma sıvısı özellikleri)" },
      { title: "Antifriz üreticilerinin ürün bilgi föyleri ve araç üreticisi onay listeleri" },
    ],
  },
  {
    slug: "muadil-parca-mi-orijinal-parca-mi",
    title: "Muadil parça mı, orijinal parça mı?",
    description: "Orijinal (OE), OES ve muadil (yan sanayi) parça arasındaki farkı, hangisini ne zaman tercih edebileceğini ve muadil parçada nelere dikkat edeceğini öğren.",
    answer: "Orijinal parça araç üreticisinin logosuyla, OES parça aynı parçayı üreten firmanın kendi markasıyla, muadil parça ise başka bir üreticinin aynı ölçü ve işlevle ürettiği parçadır. Bilinen bir markanın OEM numarasıyla eşleşen muadil parçası güvenli bir seçenektir; seçimde OEM numarası, marka ve araç uyumluluğu kontrol edilir.",
    published: "2026-11-21",
    updated: "2026-11-21",
    categories: ["yedek-parca"],
    related: [{ title: "OEM numarası nedir, nasıl bulunur?", path: "/rehber/oem-numarasi-nedir-nasil-bulunur" }, { title: "Doğru parçayı nasıl bulursun?", path: "/bilgi/uyumluluk" }],
    sources: [
      { title: "Getirbakim: Doğru parçayı nasıl bulursun?", url: "/bilgi/uyumluluk" },
      { title: "Rekabet Kurumu, Motorlu Kara Taşıtları Dağıtım ve Servis Anlaşmalarına İlişkin Grup Muafiyeti Tebliği (Tebliğ No: 2017/3)" },
      { title: "Araç sahibinin garanti belgesi" },
    ],
  },
];

export const guideBySlug = (slug: string) => guides.find(guide => guide.slug === slug);
export const guidePath = (slug: string) => `${guidesPath}/${slug}`;
export const guidesForCategory = (slug: string) => guides.filter(guide => guide.categories.includes(slug));
export const guideCategoryKeys = Object.keys(legacyCategoryIds);
