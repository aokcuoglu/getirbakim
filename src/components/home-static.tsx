"use client";
import Image from "next/image";
import Link from "next/link";
import {ChevronRight} from "lucide-react";
import {cn} from "@/lib/utils";
import {catalogPath, categoryPath} from "@/modules/seo/paths";

// The home page's static blocks as a client view (#1295): rendered once as HTML instead of twice (HTML and the RSC
// payload), the same move as HomeProductCardView (#1212). One export with a `part` switch on purpose: every client
// export a server component renders costs its own module row in the payload. Texts and links stay in the HTML.
export type HomeStaticProps =
  | {part: "about"}
  | {part: "help"}
  | {part: "title"; title: string; link?: [href: string, text: string]; note?: boolean; centered?: boolean; className?: string}
  | {part: "nav"; name: string; links: [name: string, slug: string][]}
  | {part: "category"; parent: string; name: string; slug: string; image?: string | null};

const features=[
  {icon:"discount",title:"Fiyatları birlikte incele",text:"Ürün ve fiyat bilgilerine katalogdan ulaş."},
  {icon:"truck",title:"Teslimat bilgileri",text:"Siparişten önce teslimat koşullarını kontrol et."},
  {icon:"reload",title:"İade koşulları",text:"İade süreci ve koşullarına kolayca ulaş."},
  {icon:"clipboard",title:"Uyumluluk kontrolü",text:"OEM numarası, ölçü ve araç bilgilerini karşılaştır."},
  {icon:"study-hat",title:"Alışveriş rehberi",text:"Parça seçimi için yardım sayfalarını incele."},
  {icon:"heart",title:"Aracına iyi bak",text:"Bakım ihtiyacına uygun ürünleri aynı yerde bul."},
  {icon:"search-lens",title:"Kolay parça arama",text:"Ürün, marka veya OEM numarasıyla parça ara."},
  {icon:"credit-card-secure",title:"Sipariş bilgileri",text:"Sepetindeki ürünleri siparişten önce kontrol et."},
  {icon:"user-check-rounded",title:"Alışveriş desteği",text:"Soruların için iletişim ve yardım kanallarına ulaş."},
];

// `shell` is also in page.tsx: a server component cannot read a constant from a client module.
const shell="mx-auto w-full max-w-[1350px] px-[15px]";
const taxNote=<p className="mt-1 text-[13px] leading-5 text-muted-foreground">Fiyatlar KDV dahil · Kargo hariç</p>;
const sectionTitle="mb-8 flex items-center justify-between gap-4 [&_h2]:m-0";
const noteTitle="mb-8 flex items-start justify-between gap-4 [&_h2]:m-0";
const titleLinkTop="mt-1.5 shrink-0";
const centeredTitle="mb-8 text-center [&_h2]:mb-2";
const titleLink="inline-flex items-center gap-2 text-sm leading-5 font-medium text-brand max-md:text-[13px] max-md:whitespace-nowrap";
const h2="text-[28px] leading-[34px] font-semibold tracking-[-.5px] max-md:text-[22px] max-md:leading-7";

function About() {
  return <section className={cn(shell,"mt-12 mb-[72px] max-w-[930px] text-sm leading-5 text-[#54626e] max-md:mt-8 max-md:mb-12 [&>p]:mb-5 max-md:[&>p]:mb-4 [&>p:last-child]:mb-0")}>
    <div className="mb-10 max-md:mb-8 [&>p]:mb-5 max-md:[&>p]:mb-4"><h2 className={cn(h2,"mb-5 text-foreground")}>Yedek parça ve bakım ürünleri için online mağazan</h2><p>Getirbakim, aracın için doğru parçayı bulmana yardımcı olan bir <Link href={catalogPath} className="font-medium text-primary">yedek parça</Link> mağazası. Servis deneyimimizi ve tedarik ağımızı internete taşıyor; yedek parçaları, bakım ürünlerini ve ekipmanları tek yerde sunuyoruz. Ürünleri üretici, kategori ve teknik özelliklerine göre inceleyebilir, ürün kodu veya OEM numarasıyla arama yapabilirsin.</p><p>İster aracının bakımını kendin yapıyor ol, ister profesyonel bir serviste çalışıyor ol; parça seçiminde ürün bilgilerini bir arada görmek işini kolaylaştırır. Sipariş vermeden önce OEM numarasını, ölçüleri, montaj konumunu ve araç uyumluluğunu kontrol et.</p></div>
    <Image className="mb-14 aspect-[3.75] h-auto w-full rounded-[10px] object-cover max-md:mb-10 max-md:aspect-[2.5]" src="/media/site/images/Artboard_1-4.jpg" width={1350} height={360} alt="Fren balataları, yağ ve diğer araç bakım parçaları" unoptimized/>
    <h3 className="mb-8 text-[23px] leading-[29px] font-semibold tracking-[-.5px] text-foreground max-md:mb-6 max-md:text-xl max-md:leading-[26px]">Neden Getirbakim?</h3><div className="mb-12 grid grid-cols-3 gap-4 max-md:grid-cols-2 max-[37.5rem]:grid-cols-1">{features.map(feature=><article key={feature.icon} className="relative rounded-md border border-border py-5 pr-5 pl-14 max-md:py-4 max-md:pr-4 max-md:pl-[52px]"><Image src={"/media/site/images/"+feature.icon+".svg"} width={24} height={24} alt="" unoptimized className="absolute top-5 left-5 max-md:top-4 max-md:left-4"/><h4 className="mb-2 text-base leading-6 font-medium text-foreground">{feature.title}</h4><p className="text-[13px] leading-[18px] text-pretty max-md:mb-4">{feature.text}</p></article>)}</div>
    <p>Bakım, onarım veya doğru parçayı araştırmak için ihtiyaç duyduğun ürünleri kolayca keşfet. Ürün bilgileri, kategori filtreleri ve garajın bir arada; seçim yaparken parça ve araç bilgilerini birlikte kontrol edebilirsin.</p><p>Bir bakalım, doğru parçayı bulalım.</p>
  </section>;
}

function Help() {
  return <section className="border-t border-[#dfe3e8] py-12 max-md:py-6"><div className={cn(shell,"grid grid-cols-2 gap-8 lg:grid-cols-4 max-md:grid-cols-1 max-md:gap-2 [&>a]:py-4 [&_strong]:mb-2 [&_strong]:block [&_strong]:text-base [&_strong]:leading-6 [&_strong]:font-medium [&_span]:flex [&_span]:items-center [&_span]:gap-2 [&_span]:text-[13px] [&_span]:leading-[18px] [&_span]:text-[#54626e]")}><Link href="/bilgi/uyumluluk"><strong>Parça uyumluluğunu kontrol et</strong><span>OEM ve araç bilgileriyle seçimini doğrula <ChevronRight size={14}/></span></Link><Link href="/teslimat-ve-iade"><strong>Teslimat ve iade koşulları</strong><span>Sipariş öncesi alışveriş bilgilerini incele <ChevronRight size={14}/></span></Link><Link href="/rehber"><strong>Rehber</strong><span>Kısa yanıtlarla parça seçimini öğren <ChevronRight size={14}/></span></Link><Link href="/iletisim"><strong>Yardıma mı ihtiyacın var?</strong><span>Soruların için bize ulaş <ChevronRight size={14}/></span></Link></div></section>;
}

/** A section heading: `note` adds the tax note (sections with prices), `link` the "all" link, `centered` the centred layout. */
function Title({title,link,note,centered,className}:Omit<Extract<HomeStaticProps,{part:"title"}>,"part">) {
  const more=link&&<Link href={link[0]} className={note?cn(titleLink,titleLinkTop):titleLink}>{`${link[1]} `}<ChevronRight size={14}/></Link>;
  if(centered)return <div className={cn(centeredTitle,className)}><h2 className={h2}>{title}</h2>{more}</div>;
  return <div className={cn(note?noteTitle:sectionTitle,className)}><div className="min-w-0"><h2 className={h2}>{title}</h2>{note&&taxNote}</div>{more}</div>;
}

/** A collection's "Öne çıkan kategoriler" box. */
function Nav({name,links}:{name:string;links:[name:string,slug:string][]}) {
  return <nav aria-label={name+" alt kategorileri"} className="min-h-[330px] self-start rounded-md border border-[#dfe3e8] p-5 max-md:min-h-0 max-md:p-4"><h3 className="mb-4 text-base leading-6 font-medium max-md:mb-3">Öne çıkan kategoriler</h3>{links.map(([text,slug])=><Link key={slug} href={categoryPath(slug)} className="mb-4 block text-sm leading-5 text-[#54626e] last:mb-0 hover:text-primary max-md:mr-4 max-md:mb-2 max-md:inline-block max-md:text-[13px]">{text}</Link>)}</nav>;
}

/** A collection slide for a subcategory when the collection has no product cards. */
function CategoryCard({parent,name,slug,image}:{parent:string;name:string;slug:string;image?:string|null}) {
  return <Link className="flex h-[360px] min-w-0 flex-col text-foreground max-md:h-80 max-[37.5rem]:h-[300px]" href={categoryPath(slug)}>{image&&<Image src={image} width={180} height={120} alt="" className="mx-auto mb-[30px] h-[180px] w-[180px] max-w-full object-contain max-md:mb-5 max-md:size-[170px] max-[37.5rem]:size-[150px]"/>}<span className="mb-[5px] truncate text-[13px] leading-[19.5px] text-muted-foreground">{parent}</span><strong className="line-clamp-3 text-sm leading-5 font-medium">{name}</strong><small className="mt-auto flex items-center gap-2 pb-[22px] text-[13px] leading-5 text-brand">Ürünleri incele <ChevronRight size={14}/></small></Link>;
}

export function HomeStatic(props:HomeStaticProps) {
  switch(props.part) {
    case "about": return <About/>;
    case "help": return <Help/>;
    case "title": return <Title {...props}/>;
    case "nav": return <Nav name={props.name} links={props.links}/>;
    case "category": return <CategoryCard parent={props.parent} name={props.name} slug={props.slug} image={props.image}/>;
  }
}
