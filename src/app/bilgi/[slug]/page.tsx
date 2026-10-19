import Link from "next/link";
import { LegalPage, legalMetadata } from "@/components/legal-page";
import { legalDocument } from "@/content/legal";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { contactEmail } from "@/lib/site";
const pages:Record<string,{title:string;paragraphs:string[]}>={
 hakkimizda:{title:"Parçadan anlayan insanların yedek parça mağazası.",paragraphs:["Getirbakim, araç sahipleri ve oto servisleri için, parçadan anlayan insanların yedek parça mağazasıdır. ERGUL ENERJI SAN TIC LTD STI’nin servis deneyimini, kendi stokunu ve tedarik ağını internete taşır.","Getirbakim, günlük dildeki ‘getir bir bakayım’dan geliyor. Bir parçayı eline alıp inceleyen, sorunu dinleyen ve çözüm arayan ustanın yaklaşımını taşıyor. Bir bakalım, doğru parçayı bulalım.","Mutlu Akü distribütörlüğümüz akü alanındaki deneyimimizin bir parçasıdır.","Bireysel müşteriler katalog fiyatlarını giriş yapmadan görebilir ve sepet oluşturabilir. Onaylı servis hesapları B2B fiyatlarına erişir.","Katalogdaki ürünler yetkili tedarikçilerimizin güncel fiyat ve stok bilgileriyle listelenir. Siparişler stok ve sevkiyat teyidiyle işleme alınır.",`Bize ${contactEmail} adresinden veya 0216 387 00 78 numaralı telefondan ulaşabilirsin.`]},
 uyumluluk:{title:"Doğru parçayı nasıl bulursun?",paragraphs:["Ürün veya OEM kodunu biliyorsan arama alanına yaz. Katalogda ürün adı ve markasıyla da arama yapabilirsin.","Aynı modelin farklı motor, üretim yılı ve donanım seçeneklerinde farklı parçalar kullanılır. OEM kodu, motor kodu ve araç özelliklerini karşılaştırmadan uyumluluğu varsayma.","Garajım alanına aracını eklediğinde katalog o araca göre filtrelenir. Siparişten önce ürün sayfasındaki OEM numaralarını ve uyumlu araç listesini kontrol et; emin olamadığında bize danışabilirsin."]},
 yardim:{title:"Nasıl yardımcı olabiliriz?",paragraphs:["Ürün aramak için üstteki arama alanına ürün adı, marka veya OEM kodu yaz. Kategoriler üzerinden kataloğa göz atabilirsin.","Bireysel alışveriş için servis hesabı gerekmez. Sepetin bu tarayıcıda 30 günlük güvenli bir çerezle ilişkilendirilir.","Profesyonel servis hesabı Getirbakim yönetimi tarafından onaylandıktan sonra açılır. B2B girişinde servisine tanımlı fiyatlar uygulanır ve ziyaretçi sepetin hesabına aktarılır.",`Destek: 0216 387 00 78 · ${contactEmail}. Çalışma saatleri 09:00–17:30. Siparişler stok ve sevkiyat teyidiyle işleme alınır.`]}
};
export async function generateMetadata({params}:{params:Promise<{slug:string}>}) {
 const {slug}=await params;
 const legalSlug=slug === "teslimat" ? "teslimat-ve-iade" : slug;
 if(legalDocument(legalSlug)) return legalMetadata(legalSlug);
 return {title: `${pages[slug]?.title ?? "Bilgi"} | Getirbakim`};
}
export default async function Info({params}:{params:Promise<{slug:string}>}) {
 const {slug}=await params;
 const legalSlug=slug === "teslimat" ? "teslimat-ve-iade" : slug;
 if(legalDocument(legalSlug)) return <LegalPage slug={legalSlug}/>;
 const page=Object.hasOwn(pages,slug) ? pages[slug] : undefined;
 if(!page) notFound();
 return <section className="mx-auto min-h-[55vh] w-full max-w-[830px] px-8 pt-7 pb-14 max-[600px]:px-5 max-[600px]:pt-6 max-[600px]:pb-10">
  <Link className="mb-[25px] block w-fit text-xs leading-5 text-muted-foreground hover:text-primary" href="/">← Ana sayfa</Link>
  <h1 className="mb-5 text-[32px] leading-[42px] font-semibold tracking-[-0.7px] wrap-anywhere max-[600px]:text-[27px] max-[600px]:leading-[35px]">{page.title}</h1>
  {page.paragraphs.map(p=><p key={p} className="mb-6 text-sm leading-[1.9] text-[#687581]">{p}</p>)}
  <Button nativeButton={false} className="h-auto min-h-12 gap-2.5 rounded-lg border-primary px-[27px] py-[13px] text-sm leading-5 font-medium hover:bg-brand-strong" render={<Link href="/katalog"/>}>Kataloğa göz at →</Button>
 </section>;
}
