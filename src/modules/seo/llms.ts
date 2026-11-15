import { contactEmail } from "@/lib/site";
import { legalDocument, legalLinks } from "@/content/legal";
import { absoluteUrl, categoryPath, catalogPath, makesPath } from "./paths";

const categories = [
  ["Yedek parçalar", "yedek-parca"],
  ["Fren sistemi", "fren"],
  ["Filtreler", "filtre"],
  ["Yağlar ve sıvılar", "yag"],
  ["Silecekler", "silecek"],
  ["Aksesuar ve ekipman", "aksesuar"],
] as const;

const described = ["iletisim", "teslimat-ve-iade"];

/** Plain-text site summary for language-model clients (llms.txt convention). Pure: no database access. */
export function llmsTxt(site: string) {
  const link = (title: string, path: string, note?: string) => `- [${title}](${absoluteUrl(site, path)})${note ? `: ${note}` : ""}`;
  const legal = (slug: string) => {
    const entry = legalLinks.find(item => item.slug === slug)!;
    return link(entry.title, `/${slug}`, legalDocument(slug)!.description);
  };
  return `# Getirbakim

> Getirbakim, araç sahipleri ve oto servisleri için, parçadan anlayan insanların çevrimiçi yedek parça mağazasıdır. Yedek parça, fren, filtre, yağ ve sıvı, silecek ve aksesuar ürünlerini ürün kodu, OEM numarası ve araç bilgisiyle bulmayı sağlar.

Getirbakim, ERGUL ENERJI SAN TIC LTD STI tarafından işletilir. Katalogdaki ürünler yetkili tedarikçilerin güncel fiyat ve stok bilgileriyle listelenir; siparişler stok ve sevkiyat teyidiyle işleme alınır. Bireysel müşteriler katalog fiyatlarını giriş yapmadan görebilir ve sepet oluşturabilir; onaylı servis hesapları B2B fiyatlarına erişir. Güncel fiyat, stok ve teslimat bilgisi için ilgili ürün sayfası ve sipariş öncesi bilgilendirme esas alınır.

## Katalog

${link("Yedek parça kataloğu", catalogPath, "Tüm ürünler; ürün adı, marka, ürün kodu veya OEM numarasıyla arama, kategori ve üreticiye göre inceleme.")}
${categories.map(([title, slug]) => link(title, categoryPath(slug))).join("\n")}
${link("Araç markaları", makesPath, "Araç markasına göre yedek parça listeleri.")}

## Bakım Robotu

${link("Bakım Robotu", "/bakim-robotu", "Garajdaki araç için 3'lü, 4'lü veya 5'li filtre ve motor yağı bakım setini markaları seçerek kurma; set görseli ve toplam fiyat anında görünür.")}

## Parça uyumluluğu

Aynı modelin farklı motor, üretim yılı ve donanım seçeneklerinde farklı parçalar kullanılır. Uyumluluk; OEM kodu, motor kodu ve araç özellikleri karşılaştırılarak doğrulanır. Garajım alanına araç eklendiğinde katalog o araca göre filtrelenir; siparişten önce ürün sayfasındaki OEM numaraları ve uyumlu araç listesi kontrol edilmelidir.

${link("Doğru parçayı nasıl bulursun?", "/bilgi/uyumluluk", "Ürün kodu, OEM numarası ve araç bilgisiyle uyumluluk kontrolü.")}

## Yardım, teslimat ve iletişim

${link("Yardım merkezi", "/bilgi/yardim", "Ürün arama, bireysel alışveriş ve servis hesabı hakkında yardım.")}
${legal("teslimat-ve-iade")}
${legal("iletisim").replace(/\.$/, "")}. E-posta: ${contactEmail}
${link("Hakkımızda", "/bilgi/hakkimizda", "Getirbakim'in kim olduğu ve nasıl çalıştığı.")}

## Servisler için

${link("Servisler için Getirbakim", "/servisler", "Oto servisleri için onaylı hesap; servise özel fiyatlar, ürün ve OEM koduyla parça arama.")}

## Optional

${legalLinks.filter(item => !described.includes(item.slug)).map(item => legal(item.slug)).join("\n")}
`;
}
