// Text of /bilgi/hakkimizda (#646). Sentences come from the pages already published (the old about text, the contact
// and delivery pages); the company registry block is rendered from legalDocument("iletisim") to keep one source.
import { contactEmail, contactPhone, foundingYear } from "@/lib/site";

export const aboutTitle = "Parçadan anlayan insanların yedek parça mağazası.";
export const aboutDescription = "Getirbakim’i kim işletiyor, ürünleri nereden tedarik ediyor ve parça uyumluluğunu nasıl kontrol ediyor? Şirket bilgileri, iletişim kanalları ve çalışma şeklimiz.";
export const aboutIntro = [
  "Getirbakim, araç sahipleri ve oto servisleri için, parçadan anlayan insanların yedek parça mağazasıdır. ERGUL ENERJI SAN TIC LTD STI’nin servis deneyimini, kendi stokunu ve tedarik ağını internete taşır.",
  "Getirbakim, günlük dildeki ‘getir bir bakayım’dan geliyor. Bir parçayı eline alıp inceleyen, sorunu dinleyen ve çözüm arayan ustanın yaklaşımını taşıyor. Bir bakalım, doğru parçayı bulalım.",
];
export const aboutSections = {
  contact: ["Siparişin varsa sipariş numaranı paylaşman talebinin bulunmasını kolaylaştırır."],
  experience: [
    `Getirbakim ${foundingYear} yılında kuruldu.`,
    "Mutlu Akü distribütörlüğümüz akü alanındaki deneyimimizin bir parçasıdır.",
    "Bireysel müşteriler katalog fiyatlarını giriş yapmadan görebilir ve sepet oluşturabilir. Onaylı servis hesapları B2B fiyatlarına erişir.",
  ],
  supply: ["Katalogdaki ürünler yetkili tedarikçilerimizin güncel fiyat ve stok bilgileriyle listelenir. Siparişler stok ve sevkiyat teyidiyle işleme alınır."],
  compatibility: [
    "Aynı modelin farklı motor, üretim yılı ve donanım seçeneklerinde farklı parçalar kullanılır; bu yüzden uyumluluğu garanti ettiğimizi söylemiyoruz. Garajım alanına araç eklediğinde katalog o araca göre filtrelenir.",
    "Siparişten önce ürün sayfasındaki OEM numaralarını ve uyumlu araç listesini kontrol et. Emin olamadığında bize danışabilirsin.",
  ],
};
export const aboutContact = { phone: "0216 387 00 78", phoneHref: contactPhone, email: contactEmail, hours: "09.00–17.30" };
