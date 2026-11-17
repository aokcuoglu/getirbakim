// Frequently asked questions (#646). Answers are plain text: the page prints them and the FAQPage JSON-LD repeats the
// same string. Only facts from the legal pages and docs/commerce.md, docs/payments.md; no amounts, carrier or invoice
// type is stated here until the shop's owners provide them.
export type FaqLink = { title: string; href: string };
export type FaqItem = { question: string; answer: string; links?: FaqLink[] };
export type FaqGroup = { id: string; title: string; items: FaqItem[] };

const returns: FaqLink = { title: "Teslimat ve İade", href: "/teslimat-ve-iade" };
const compatibility: FaqLink = { title: "Doğru parçayı nasıl bulursun?", href: "/bilgi/uyumluluk" };
const oemGuide: FaqLink = { title: "OEM numarası nedir, nasıl bulunur?", href: "/rehber/oem-numarasi-nedir-nasil-bulunur" };

export const faqGroups: FaqGroup[] = [
  {
    id: "siparis-ve-odeme", title: "Sipariş ve ödeme",
    items: [
      { question: "Sipariş vermek için servis hesabı gerekir mi?",
        answer: "Hayır. Bireysel alışveriş için servis hesabı gerekmez; katalog fiyatlarını giriş yapmadan görebilir, sepet oluşturup sipariş verebilirsin. Sepetin bu tarayıcıda 30 günlük bir çerezle ilişkilendirilir." },
      { question: "Nasıl ödeme yapabilirim?",
        answer: "Ödeme kartla, ortak ödeme sayfasında alınır. Kart bilgilerin Getirbakim’e iletilmez." },
      { question: "Siparişimin durumunda “Teyit bekliyor” ne anlama gelir?",
        answer: "Ödemen doğrulandıktan sonra sipariş “Teyit bekliyor” durumuna geçer. Siparişler stok ve sevkiyat teyidiyle işleme alınır; teyit tamamlanana kadar sipariş bu durumda görünür." },
      { question: "Siparişimi iptal edebilir miyim?",
        answer: "Sipariş sayfasındaki “Siparişi iptal et” düğmesiyle, sipariş onaylanmadan önce iptal edebilirsin. Onaylanmış, kargoya verilmiş veya teslim edilmiş siparişler bu düğmeyle iptal edilemez; bu durumda cayma hakkı kapsamındaki koşullar geçerlidir.",
        links: [returns] },
    ],
  },
  {
    id: "kargo-ve-teslimat", title: "Kargo ve teslimat",
    items: [
      { question: "Kargo ücreti ne kadar?",
        answer: "Kargo bedeli ve varsa ücretsiz kargo koşulu sepet ve sipariş özetinde gösterilir; ödemeden önce toplamda görebilirsin." },
      { question: "Siparişim en geç ne zaman teslim edilir?",
        answer: "Sipariş, sipariş öncesinde taahhüt edilen süre içinde yerine getirilir. Kişiye özel hazırlanan mallar dışında, mal satışlarında bu süre 30 günü aşamaz. Siparişe özgü teslimat bilgisi sipariş öncesinde ayrıca sunulur.",
        links: [returns] },
    ],
  },
  {
    id: "iade-ve-cayma", title: "İade ve cayma",
    items: [
      { question: "Siparişimi iade edebilir miyim?",
        answer: "Ürünü teslim aldığın tarihten itibaren 14 gün içinde gerekçe göstermeden ve cezai şart ödemeden sözleşmeden cayabilirsin. Cayma bildirimini yazılı olarak veya kalıcı veri saklayıcısıyla iletmen gerekir; ayrıntılar ve örnek bildirim Teslimat ve İade sayfasındadır.",
        links: [returns] },
      { question: "Ödemem ne zaman iade edilir?",
        answer: "Tahsil edilen bedeller, Teslimat ve İade sayfasında açıklanan koşullarda 14 gün içinde, satın alma sırasında kullanılan ödeme aracına geri ödenir.",
        links: [returns] },
    ],
  },
  {
    id: "parca-uyumlulugu", title: "Parça uyumluluğu",
    items: [
      { question: "Parçanın aracıma uyduğunu nasıl anlarım?",
        answer: "Ürün sayfasındaki OEM numaralarını ve uyumlu araç listesini; aracının motor kodu, üretim yılı ve özellikleriyle karşılaştır. Aynı modelin farklı motor ve donanım seçeneklerinde farklı parçalar kullanılabilir, bu yüzden model adı tek başına yeterli değildir.",
        links: [compatibility, oemGuide] },
      { question: "Garajım uyumluluğu garanti eder mi?",
        answer: "Hayır. Garajım alanına aracını eklediğinde katalog o araca göre filtrelenir; ancak siparişten önce ürün sayfasındaki OEM numaralarını ve uyumlu araç listesini kontrol etmelisin. Emin olamadığında bize danışabilirsin.",
        links: [{ title: "Garajım", href: "/garaj" }] },
    ],
  },
  {
    id: "fatura", title: "Fatura",
    items: [
      { question: "Fatura düzenleniyor mu?",
        answer: "Fatura, yürürlükteki vergi mevzuatına uygun olarak düzenlenir." },
    ],
  },
  {
    id: "servis-hesabi", title: "Servis hesabı",
    items: [
      { question: "Servis hesabı nedir, nasıl açılır?",
        answer: "Profesyonel servis hesabı, başvurunun Getirbakim yönetimi tarafından onaylanmasından sonra açılır. Başvuruyu servisler sayfasından yapabilirsin.",
        links: [{ title: "Servisler için Getirbakim", href: "/servisler" }, { title: "Servis hesabı başvurusu", href: "/servisler/basvuru" }] },
      { question: "Servis hesabında fiyatlar farklı mı?",
        answer: "Onaylı servis hesapları B2B fiyatlarına erişir. Servisine tanımlı fiyatlar giriş yaptıktan sonra uygulanır ve ziyaretçi sepetin hesabına aktarılır." },
    ],
  },
];
