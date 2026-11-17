import Link from "next/link";
import { LegalPage, legalMetadata } from "@/components/legal-page";
import { legalDocument } from "@/content/legal";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { pageMetadata, siteUrl } from "@/lib/site";
import { JsonLd } from "@/components/json-ld";
import { aboutPageJsonLd, breadcrumbJsonLd, pageTrail } from "@/modules/seo/structured-data";
import { AboutContent, FaqContent, Paragraphs } from "@/components/info-pages";
import { aboutDescription, aboutTitle } from "@/content/about";
import { catalogPath } from "@/modules/seo/paths";
const pages:Record<string,{title:string;seoTitle:string;description:string;paragraphs:string[]}>={
 hakkimizda:{title:aboutTitle,seoTitle:"Hakkımızda",description:aboutDescription,paragraphs:[]},
 uyumluluk:{title:"Doğru parçayı nasıl bulursun?",seoTitle:"Parça uyumluluğu rehberi",description:"Aracına uyan parçayı OEM kodu, motor kodu, üretim yılı ve Garajım ile nasıl doğrulayacağını adım adım öğren.",paragraphs:["Ürün veya OEM kodunu biliyorsan arama alanına yaz. Katalogda ürün adı ve markasıyla da arama yapabilirsin.","Aynı modelin farklı motor, üretim yılı ve donanım seçeneklerinde farklı parçalar kullanılır. OEM kodu, motor kodu ve araç özelliklerini karşılaştırmadan uyumluluğu varsayma.","Garajım alanına aracını eklediğinde katalog o araca göre filtrelenir. Siparişten önce ürün sayfasındaki OEM numaralarını ve uyumlu araç listesini kontrol et; emin olamadığında bize danışabilirsin."]},
 yardim:{title:"Sıkça sorulan sorular",seoTitle:"Sıkça sorulan sorular ve yardım",description:"Sipariş, ödeme, kargo, iade, parça uyumluluğu, fatura ve servis hesabı hakkında kısa yanıtlar; 09.00–17.30 arası telefon ve e-posta desteği.",paragraphs:[]}
};
export async function generateMetadata({params}:{params:Promise<{slug:string}>}) {
 const {slug}=await params;
 const legalSlug=slug === "teslimat" ? "teslimat-ve-iade" : slug;
 if(legalDocument(legalSlug)) return legalMetadata(legalSlug);
 const page=Object.hasOwn(pages,slug) ? pages[slug] : undefined;
 if(!page) return {title:"Bilgi",robots:{index:false}};
 return pageMetadata({title:page.seoTitle,description:page.description,path:`/bilgi/${slug}`});
}
export default async function Info({params}:{params:Promise<{slug:string}>}) {
 const {slug}=await params;
 const legalSlug=slug === "teslimat" ? "teslimat-ve-iade" : slug;
 if(legalDocument(legalSlug)) return <LegalPage slug={legalSlug}/>;
 const page=Object.hasOwn(pages,slug) ? pages[slug] : undefined;
 if(!page) notFound();
 return <section className="mx-auto min-h-[55vh] w-full max-w-[830px] px-8 pt-7 pb-14 max-[600px]:px-5 max-[600px]:pt-6 max-[600px]:pb-10">
  <JsonLd data={breadcrumbJsonLd(pageTrail(page.seoTitle,`/bilgi/${slug}`),siteUrl)}/>
  <Link className="mb-[25px] block w-fit text-xs leading-5 text-muted-foreground hover:text-primary" href="/">← Ana sayfa</Link>
  <h1 className="mb-5 text-[32px] leading-[42px] font-semibold tracking-[-0.7px] wrap-anywhere max-[600px]:text-[27px] max-[600px]:leading-[35px]">{page.title}</h1>
  {slug==="hakkimizda"&&<><JsonLd data={aboutPageJsonLd(`/bilgi/${slug}`,siteUrl)}/><AboutContent/></>}
  {slug==="yardim"&&<FaqContent/>}
  <Paragraphs items={page.paragraphs}/>
  {slug==="uyumluluk"&&<p className="mb-6 text-sm leading-[1.9] text-[#546371]">Numarayı nerede bulacağını <Link className="text-primary underline underline-offset-3" href="/rehber/oem-numarasi-nedir-nasil-bulunur">OEM numarası nedir, nasıl bulunur?</Link> yazısında anlattık.</p>}
  <Button nativeButton={false} className="h-auto min-h-12 gap-2.5 rounded-lg border-primary px-[27px] py-[13px] text-sm leading-5 font-medium hover:bg-brand-strong" render={<Link href={catalogPath}/>}>Kataloğa göz at →</Button>
 </section>;
}
