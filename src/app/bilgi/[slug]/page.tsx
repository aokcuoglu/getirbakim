import Link from "next/link";
import { LegalPage, legalMetadata } from "@/components/legal-page";
import { legalDocument } from "@/content/legal";
import { notFound } from "next/navigation";
const pages:Record<string,{title:string;paragraphs:string[]}>={
 hakkimizda:{title:"Parçadan anlayan insanların yedek parça mağazası.",paragraphs:["Getirbakim, araç sahipleri ve oto servisleri için, parçadan anlayan insanların yedek parça mağazasıdır. ERGUL ENERJI SAN TIC LTD STI’nin servis deneyimini, kendi stokunu ve tedarik ağını internete taşır.","Getirbakim, günlük dildeki ‘getir bir bakayım’dan geliyor. Bir parçayı eline alıp inceleyen, sorunu dinleyen ve çözüm arayan ustanın yaklaşımını taşıyor. Bir bakalım, doğru parçayı bulalım.","Mutlu Akü distribütörlüğümüz akü alanındaki deneyimimizin bir parçasıdır. Yerinde teslimat ve montaj hizmetinin bölge, saat ve ücret koşulları netleştiğinde ayrıca yayınlanacaktır.","Bireysel müşteriler katalog fiyatlarını giriş yapmadan görebilir ve sepet oluşturabilir. Onaylı servis hesapları B2B fiyatlarına erişir.","Platform geliştirme aşamasındadır. Tedarikçi ürünleri katalogda incelenebilir; satış fiyatı ve bulunabilirliği doğrulanmamış ürünler satın alınamaz. Sipariş talepleri stok ve sevkiyat teyidiyle değerlendirilir. Çevrimiçi ödeme henüz açılmamıştır."]},
 uyumluluk:{title:"Doğru parçayı nasıl bulursun?",paragraphs:["Ürün veya OEM kodunu biliyorsan arama alanına yaz. Katalogda ürün adı ve markasıyla da arama yapabilirsin.","Aynı modelin farklı motor, üretim yılı ve donanım seçeneklerinde farklı parçalar kullanılır. OEM kodu, motor kodu ve araç özelliklerini karşılaştırmadan uyumluluğu varsayma.","Garajım alanındaki araç kaydı bir tercih bilgisidir. Henüz doğrulanmış araç-parça eşleştirmesi veya otomatik uyumluluk kontrolü sunulmamaktadır."]},
 yardim:{title:"Nasıl yardımcı olabiliriz?",paragraphs:["Ürün aramak için üstteki arama alanına ürün adı, marka veya OEM kodu yaz. Kategoriler üzerinden kataloğa göz atabilirsin.","Bireysel alışveriş için servis hesabı gerekmez. Sepetin bu tarayıcıda 30 günlük güvenli bir çerezle ilişkilendirilir.","Profesyonel servis hesabı Getirbakim yönetimi tarafından onaylandıktan sonra açılır. B2B girişinde servisine tanımlı fiyatlar uygulanır ve ziyaretçi sepetin hesabına aktarılır.","Destek: 0216 387 00 78 · info@ergulenerji.com. Çalışma saatleri 09:00–17:30. Bu aşamada çevrimiçi ödeme alınmamaktadır; sipariş talepleri stok ve sevkiyat teyidine bağlıdır."]}
};
export async function generateMetadata({params}:{params:Promise<{slug:string}>}) {
 const {slug}=await params; const legalSlug=slug === "teslimat" ? "teslimat-ve-iade" : slug;
 if(legalDocument(legalSlug)) return legalMetadata(legalSlug);
 return {title: `${pages[slug]?.title ?? "Bilgi"} | Getirbakim`};
}
export default async function Info({params}:{params:Promise<{slug:string}>}) {
 const {slug}=await params; const legalSlug=slug === "teslimat" ? "teslimat-ve-iade" : slug; if(legalDocument(legalSlug)) return <LegalPage slug={legalSlug}/>;const page=Object.hasOwn(pages,slug) ? pages[slug] : undefined;if(!page)notFound();return <section className="shell info-page page-section"><Link className="back" href="/">← Ana sayfa</Link><h1 className="page-title">{page.title}</h1>{page.paragraphs.map(p=><p key={p}>{p}</p>)}<Link className="button" href="/katalog">Kataloğa göz at →</Link></section>;
}
