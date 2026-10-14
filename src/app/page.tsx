import {normalizeSearchParams,type SearchParams} from "@/lib/search-params";
import Image from "next/image";
import Link from "next/link";
import {Search,ChevronRight} from "lucide-react";
import {redirect} from "next/navigation";
import {getStoreCategories} from "@/modules/store/categories";
import {currentVehicle} from "@/modules/store/garage";
import {currentAccount} from "@/modules/auth/session";
import {GarageButton} from "@/components/garage/garage-button";
import {HomeCarousel,HomeCategoryTabs,HomeGridPager,HomeScrollHeader} from "@/components/home-controls";
import {getVehicleBrands} from "@/modules/store/vehicle-catalog.server";
import {vehicleBrandSlug,popularVehicleMakes} from "@/modules/store/vehicle-catalog";
import {catalogBrands} from "@/modules/store/catalog";
import {getHomeProducts,getHomeProductCategories} from "@/modules/store/home";
import {getCatalogProductDetails,getCatalogProductImages} from "@/modules/store/product-enrichment";
import {getManufacturerLogos} from "@/modules/store/manufacturer-logos";
import {getVehicleLogo} from "@/modules/store/storefront-logos";
import {HomeProductCard} from "@/components/home-product-card";
import {NewsletterSignup} from "@/components/newsletter-signup";
import {Input} from "@/components/ui/input";
import {Button} from "@/components/ui/button";
import {cn} from "@/lib/utils";
import {organizationJsonLd} from "@/lib/site";

const manufacturerOrder=["BOSCH","FEBI","LUK","SKF","GATES","SACHS","FAG","MANN","TRW","LEMFORDER","DENSO","CONTITECH","ELRING","MOOG","PIERBURG","CTR","VALEO","INA","BLUE PRINT","LESJOFORS","DELPHI","HELLA","MAHLE","NGK","DAYCO","NRF","DEPO","PURFLUX","HENGST","ATE","BERU","CHAMPION","FERODO","JURID","TEXTAR","CORTECO","BORGWARNER","GARRETT","NTN-SNR","AISIN","GKN","STABILUS","VERNET","UFI","SHELL","TOTAL","OSRAM","VDO"];
const promotions=[
  {image:"home-spark-plugs.webp",category:327,label:"ATEŞLEME SİSTEMİ",title:"Bujiler ve kızdırma bujileri",description:"Aracının bakımına uygun parçaları keşfet."},
  {image:"home-wiper-blades.webp",category:607,label:"SİLECEKLER",title:"Her koşulda net görüş",description:"Silecekleri uzunluk ve bağlantı tipine göre incele."},
  {image:"home-engine-parts.webp",category:4,label:"MOTOR PARÇALARI",title:"Motoruna iyi bak",description:"Triger, kayış, motor takozu ve conta seçenekleri."},
  {image:"w40_brake_discs_web.jpg",category:269,label:"FREN DİSKLERİ",title:"Her duruşta güven",description:"Fren disklerini ölçü ve montaj konumuna göre karşılaştır."},
  {image:"com_desktop_656x292_711.jpeg",href:"/bilgi/uyumluluk",title:"Parça uyumluluğunu kontrol et",description:"Ürün seçimini OEM numarası ve araç bilgileriyle doğrula."},
  {image:"com_desktop_656x292_710_1.jpeg",href:"/teslimat-ve-iade",title:"Teslimat ve iade bilgileri",description:"Sipariş öncesinde teslimat ve iade koşullarını incele."},
  {image:"656x292px_we_ship_worldwide_4.jpg",href:"/katalog",title:"Aracın için doğru parça",description:"Yedek parça, bakım ürünleri ve ekipmanlar tek yerde."},
];
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

const shell="mx-auto w-full max-w-[1350px] px-[15px]";
const sectionTitle="mb-8 flex items-center justify-between gap-4 [&_h2]:m-0";
const centeredTitle="mb-8 text-center [&_h2]:mb-2";
const titleLink="inline-flex items-center gap-2 text-sm leading-5 font-medium text-brand max-md:text-[13px] max-md:whitespace-nowrap";
const h2="text-[28px] leading-[34px] font-semibold tracking-[-.5px] max-md:text-[22px] max-md:leading-7";

export default async function Home({searchParams}:{searchParams:Promise<SearchParams>}) {
  const {q}=normalizeSearchParams(await searchParams);
  if(q)redirect("/katalog?q="+encodeURIComponent(q));
  const [vehicle,allCategories,vehicleBrands,brands,products,account,collections]=await Promise.all([currentVehicle(),getStoreCategories(),getVehicleBrands(),catalogBrands(),getHomeProducts(),currentAccount(),Promise.all([967,1023,11058].map(async categoryId=>({categoryId,products:await getHomeProducts(categoryId)})))]);
  const categories=[3,607,956,967,1023,11058].flatMap(id=>allCategories.filter(category=>category.id===id));
  const rootIds=new Set(allCategories.filter(category=>category.parentId===null).map(category=>category.id));
  const tabCategories=allCategories.filter(category=>category.parentId===null||rootIds.has(category.parentId));
  const makes=popularVehicleMakes.flatMap(name=>vehicleBrands.filter(brand=>brand.name===name));
  const manufacturers=manufacturerOrder.filter(brand=>brands.includes(brand));
  const allProducts=[...new Map([...products,...collections.flatMap(collection=>collection.products)].map(product=>[product.id,product])).values()];
  const [logos,images,details,productCategories]=await Promise.all([getManufacturerLogos(manufacturers),getCatalogProductImages(allProducts),getCatalogProductDetails(allProducts),getHomeProductCategories(allProducts)]);
  const visibleProducts=products.filter(product=>images.has(product.id)&&details.has(product.id));
  const productCard=(product:typeof products[number])=><HomeProductCard key={product.id} product={product} image={images.get(product.id)} partNumber={details.get(product.id)?.partNumber} category={productCategories.get(product.id)} account={account}/>;
  return <div className="bg-white text-foreground">
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(organizationJsonLd).replace(/</g,"\\u003c")}}/>
    <HomeScrollHeader/>
    <section className="relative h-[280px] bg-[linear-gradient(#212b36cc,#212b36cc),url('/media/site/images/Hero_image.webp')] bg-cover bg-center bg-no-repeat pb-10 text-white max-[37.5rem]:h-[288px] max-[37.5rem]:min-h-[288px] max-[37.5rem]:pb-6">
      <div className="flex h-[52px] items-center justify-center gap-2 bg-[#212b3633] text-sm text-white/86 max-[37.5rem]:h-10 max-[37.5rem]:text-xs"><Search size={18} aria-hidden="true"/><span>Ürün kodu ve OEM numarasıyla parça arama</span></div>
      <div className="mx-auto w-full max-w-[1384px] px-8 max-[37.5rem]:px-4"><h1 className="mt-3 mb-4 flex h-24 items-center justify-center text-center text-[34px] leading-[42px] font-semibold tracking-[-.7px] max-[37.5rem]:mt-4 max-[37.5rem]:mb-5 max-[37.5rem]:h-[34px] max-[37.5rem]:text-[26px] max-[37.5rem]:leading-[34px]">Yedek parça alışverişi</h1><div className="flex items-center justify-center py-1 max-[37.5rem]:mx-auto max-[37.5rem]:max-w-[400px] max-[37.5rem]:flex-wrap max-[37.5rem]:p-0">
        <form action="/katalog" className="flex gap-2.5 max-[37.5rem]:w-full" role="search" aria-label="OEM numarasıyla parça ara"><label className="flex h-14 w-[296px] overflow-hidden rounded-md border border-white bg-white max-[53.125rem]:w-60 max-[37.5rem]:w-auto max-[37.5rem]:min-w-0 max-[37.5rem]:flex-1"><span aria-hidden="true" className="flex flex-[0_0_36px] items-center justify-center bg-[#003399] text-[11px] font-semibold text-white">OEM</span><Input type="search" name="q" aria-label="Ürün kodu veya OEM numarası" placeholder="Ürün kodu veya OEM numarası" minLength={2} maxLength={120} required className="h-[54px] min-h-0 rounded-none border-0 bg-white px-2.5 py-3.5 text-sm text-[#54626e] focus-visible:ring-0 md:text-sm"/></label><input type="hidden" name="searchBy" value="code"/><Button type="submit" aria-label="OEM ile ara" className="size-14 min-h-0 rounded-md border-brand bg-brand text-white hover:border-brand-strong hover:bg-brand-strong [&_svg:not([class*='size-'])]:size-5"><Search aria-hidden="true"/></Button></form>
        <span className="relative mx-[25px] w-4 py-[18px] text-center text-xs font-medium whitespace-nowrap text-white/75 uppercase before:absolute before:top-0 before:left-1/2 before:h-[17px] before:w-px before:bg-[#e6e9ec33] after:absolute after:bottom-0 after:left-1/2 after:h-[17px] after:w-px after:bg-[#e6e9ec33] max-[53.125rem]:mx-4 max-[37.5rem]:m-0 max-[37.5rem]:block max-[37.5rem]:h-[42px] max-[37.5rem]:w-full max-[37.5rem]:py-3 max-[37.5rem]:leading-[18px] max-[37.5rem]:before:top-1/2 max-[37.5rem]:before:left-0 max-[37.5rem]:before:h-px max-[37.5rem]:before:w-[calc(50%-20px)] max-[37.5rem]:after:top-1/2 max-[37.5rem]:after:right-0 max-[37.5rem]:after:bottom-auto max-[37.5rem]:after:left-auto max-[37.5rem]:after:h-px max-[37.5rem]:after:w-[calc(50%-20px)]">veya</span><GarageButton vehicle={vehicle} variant="catalog"/>
      </div></div>
    </section>
    <section className="mb-[87px] bg-[#fafafa] pt-14 pb-[77px] max-md:mb-12 max-md:pt-10 max-md:pb-12">
      <nav className={cn(shell,"flex items-start justify-between gap-4 max-[68.75rem]:gap-2 max-md:grid max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-[15px] max-md:pb-[15px]")} aria-label="Popüler kategoriler">{categories.map(category=><Link key={category.id} href={"/katalog?category="+category.slug} className="flex min-w-0 flex-1 flex-col items-center text-center text-sm leading-5 font-medium text-foreground hover:text-primary">{category.imagePath&&<Image src={category.imagePath} width={135} height={90} alt="" unoptimized className="h-[90px] w-[135px] max-w-full object-contain mix-blend-darken"/>}<span className="mt-[15px] whitespace-nowrap max-[68.75rem]:min-h-10 max-[68.75rem]:whitespace-normal max-md:min-h-5">{category.id===1023?"El aletleri":category.name}</span></Link>)}</nav>
      <div className={cn(shell,"mt-14 max-md:mt-8")}><HomeCarousel label="Öne çıkan kategoriler">{promotions.map(promotion=>{
        const category=allCategories.find(category=>category.id===promotion.category);
        return <Link className="relative block h-[292px] overflow-hidden rounded-md bg-foreground text-white after:absolute after:inset-[65%_0_0] after:bg-[linear-gradient(transparent,#0008_30%,#000_90%)] max-md:h-[250px]" key={promotion.image} href={promotion.href??(category?"/katalog?category="+category.slug:"/katalog")}><Image src={"/media/site/images/"+promotion.image} fill sizes="(max-width:768px) 100vw, (max-width:1350px) 50vw, 656px" alt="" unoptimized className="object-cover"/>{promotion.label&&<span className="absolute top-5 left-8 z-[1] rounded-[2px] bg-[#c94037] px-3 py-2 text-[17px] leading-6 font-semibold text-white max-md:left-5 max-md:px-2.5 max-md:py-1.5 max-md:text-sm">{promotion.label}</span>}<div className="absolute inset-x-0 bottom-5 z-[1] px-8 [text-shadow:1px_1px_2px_black] max-md:px-5"><h2 className="mb-1 text-[23px] leading-[29px] font-semibold tracking-[-.5px] max-md:text-xl max-md:leading-[26px]">{promotion.title}</h2><p className="text-sm leading-5">{promotion.description}</p></div></Link>;
      })}</HomeCarousel></div>
      <div className={shell}><HomeCategoryTabs categories={tabCategories}/></div>
    </section>
    {visibleProducts.length>0&&<section className={cn(shell,"mb-[30px] pb-[45px] max-md:mb-10")}><div className={sectionTitle}><h2 className={h2}>Ürünleri keşfet</h2><Link href="/katalog" className={titleLink}>Tüm ürünler <ChevronRight size={14}/></Link></div><HomeCarousel kind="products" label="Ürünleri keşfet">{visibleProducts.slice(0,12).map(productCard)}</HomeCarousel></section>}
    {visibleProducts.length>12&&<section className={cn(shell,"mb-[30px] pb-[45px] max-md:mb-10")}><div className={sectionTitle}><h2 className={h2}>Diğer ürünler</h2><Link href="/katalog" className={titleLink}>Kataloğa git <ChevronRight size={14}/></Link></div><HomeCarousel kind="products" label="Diğer ürünler">{visibleProducts.slice(12).map(productCard)}</HomeCarousel></section>}
    <section className={cn(shell,"mt-[60px] pb-12 max-md:mt-10 max-md:pb-14")}><div className={centeredTitle}><h2 className={h2}>Popüler araç markaları</h2><Link href="/automakers" className={titleLink}>Tüm araç markaları <ChevronRight size={14}/></Link></div><HomeGridPager kind="makes" label="Araç markaları">{makes.map(make=>{const logo=getVehicleLogo(make.name);return <Link key={make.id} prefetch={false} href={"/car-parts/"+vehicleBrandSlug(make.name)} aria-label={make.name} className="flex h-[88px] min-w-0 flex-col items-center justify-center gap-2 rounded-md border border-border bg-white p-2.5 text-center text-xs leading-4 font-medium text-foreground hover:border-brand hover:text-primary">{logo&&<Image src={logo.src} width={logo.width} height={logo.height} alt="" unoptimized className="h-[42px] w-[92px] max-w-full object-contain"/>}<span className="max-w-full wrap-anywhere">{make.name==="VOLKSWAGEN"?"VW":make.name}</span></Link>;})}</HomeGridPager></section>
    <section className={cn(shell,"mt-[60px] pb-12 max-md:mt-10 max-md:pb-14")}><div className={cn(centeredTitle,"mb-10 max-md:mb-6")}><h2 className={h2}>Popüler üreticiler</h2></div><HomeGridPager kind="manufacturers" label="Üreticiler">{manufacturers.map(brand=>{const logo=logos.get(brand);return <Link key={brand} prefetch={false} href={"/katalog?brand="+encodeURIComponent(brand)} aria-label={brand} className="flex h-[70px] min-w-0 items-center justify-center bg-white px-[7px] text-center text-sm leading-[18px] font-medium text-foreground hover:bg-[#f8f9f9] hover:text-primary max-md:px-2 max-md:text-[13px]">{logo?<Image src={logo.src} width={logo.width} height={logo.height} alt={brand} unoptimized className="h-[50px] w-[120px] max-w-full object-contain"/>:<span>{brand}</span>}</Link>;})}</HomeGridPager></section>
    <div className="mt-[60px] max-md:mt-10">{collections.map(collection=>{
      const category=allCategories.find(category=>category.id===collection.categoryId);
      if(!category)return null;
      const children=allCategories.filter(child=>child.parentId===category.id);
      const entries=collection.products.filter(product=>images.has(product.id)&&details.has(product.id));
      return <section className={cn(shell,"mb-[60px] pb-[45px] max-md:mb-10")} key={category.id}><div className={sectionTitle}><h2 className={h2}>{category.name}</h2><Link href={"/katalog?category="+category.slug} className={titleLink}>Tüm ürünler <ChevronRight size={14}/></Link></div><div className="grid grid-cols-[220px_minmax(0,1fr)] gap-4 max-md:grid-cols-1"><nav aria-label={category.name+" alt kategorileri"} className="min-h-[330px] self-start rounded-md border border-[#dfe3e8] p-5 max-md:min-h-0 max-md:p-4"><h3 className="mb-4 text-base leading-6 font-medium max-md:mb-3">Öne çıkan kategoriler</h3>{children.slice(0,5).map(child=><Link key={child.id} href={"/katalog?category="+child.slug} className="mb-4 block text-sm leading-5 text-[#54626e] last:mb-0 hover:text-primary max-md:mr-4 max-md:mb-2 max-md:inline-block max-md:text-[13px]">{child.name}</Link>)}</nav><HomeCarousel kind="products" columns={4} label={category.name}>{entries.length?entries.map(productCard):(children.length>5?children.slice(5,15):children).map(child=><Link className="flex h-[360px] min-w-0 flex-col text-foreground max-md:h-80 max-[37.5rem]:h-[300px]" key={child.id} href={"/katalog?category="+child.slug}>{child.imagePath&&<Image src={child.imagePath} width={180} height={120} alt="" unoptimized className="mx-auto mb-[30px] h-[180px] w-[180px] max-w-full object-contain max-md:mb-5 max-md:size-[170px] max-[37.5rem]:size-[150px]"/>}<span className="mb-[5px] truncate text-[13px] leading-[19.5px] text-muted-foreground">{category.name}</span><strong className="line-clamp-3 text-sm leading-5 font-medium">{child.name}</strong><small className="mt-auto flex items-center gap-2 pb-[22px] text-[13px] leading-5 text-brand">Ürünleri incele <ChevronRight size={14}/></small></Link>)}</HomeCarousel></div></section>;
    })}</div>
    <section className={cn(shell,"mt-12 mb-[72px] max-w-[930px] text-sm leading-5 text-[#54626e] max-md:mt-8 max-md:mb-12 [&>p]:mb-5 max-md:[&>p]:mb-4 [&>p:last-child]:mb-0")}>
      <div className="mb-10 max-md:mb-8 [&>p]:mb-5 max-md:[&>p]:mb-4"><h2 className={cn(h2,"mb-5 text-foreground")}>Yedek parça ve bakım ürünleri için online mağazan</h2><p>Getirbakim, aracın için doğru parçayı bulmana yardımcı olan bir <Link href="/katalog" className="font-medium text-primary">yedek parça</Link> mağazası. Servis deneyimimizi ve tedarik ağımızı internete taşıyor; yedek parçaları, bakım ürünlerini ve ekipmanları tek yerde sunuyoruz. Ürünleri üretici, kategori ve teknik özelliklerine göre inceleyebilir, ürün kodu veya OEM numarasıyla arama yapabilirsin.</p><p>İster aracının bakımını kendin yapıyor ol, ister profesyonel bir serviste çalışıyor ol; parça seçiminde ürün bilgilerini bir arada görmek işini kolaylaştırır. Sipariş vermeden önce OEM numarasını, ölçüleri, montaj konumunu ve araç uyumluluğunu kontrol et.</p></div>
      <Image className="mb-14 aspect-[3.75] h-auto w-full rounded-[10px] object-cover max-md:mb-10 max-md:aspect-[2.5]" src="/media/site/images/Artboard_1-4.jpg" width={1350} height={360} alt="Fren balataları, yağ ve diğer araç bakım parçaları" unoptimized/>
      <h3 className="mb-8 text-[23px] leading-[29px] font-semibold tracking-[-.5px] text-foreground max-md:mb-6 max-md:text-xl max-md:leading-[26px]">Neden Getirbakim?</h3><div className="mb-12 grid grid-cols-3 gap-4 max-md:grid-cols-2 max-[37.5rem]:grid-cols-1">{features.map(feature=><article key={feature.icon} className="relative rounded-md border border-border py-5 pr-5 pl-14 max-md:py-4 max-md:pr-4 max-md:pl-[52px]"><Image src={"/media/site/images/"+feature.icon+".svg"} width={24} height={24} alt="" unoptimized className="absolute top-5 left-5 max-md:top-4 max-md:left-4"/><h4 className="mb-2 text-base leading-6 font-medium text-foreground">{feature.title}</h4><p className="text-[13px] leading-[18px] text-pretty max-md:mb-4">{feature.text}</p></article>)}</div>
      <p>Bakım, onarım veya doğru parçayı araştırmak için ihtiyaç duyduğun ürünleri kolayca keşfet. Ürün bilgileri, kategori filtreleri ve garajın bir arada; seçim yaparken parça ve araç bilgilerini birlikte kontrol edebilirsin.</p><p>Bir bakalım, doğru parçayı bulalım.</p>
    </section>
    <section className="border-t border-[#dfe3e8] py-12 max-md:py-6"><div className={cn(shell,"grid grid-cols-3 gap-8 max-md:grid-cols-1 max-md:gap-2 [&>a]:py-4 [&_strong]:mb-2 [&_strong]:block [&_strong]:text-base [&_strong]:leading-6 [&_strong]:font-medium [&_span]:flex [&_span]:items-center [&_span]:gap-2 [&_span]:text-[13px] [&_span]:leading-[18px] [&_span]:text-[#54626e]")}><Link href="/bilgi/uyumluluk"><strong>Parça uyumluluğunu kontrol et</strong><span>OEM ve araç bilgileriyle seçimini doğrula <ChevronRight size={14}/></span></Link><Link href="/teslimat-ve-iade"><strong>Teslimat ve iade koşulları</strong><span>Sipariş öncesi alışveriş bilgilerini incele <ChevronRight size={14}/></span></Link><Link href="/iletisim"><strong>Yardıma mı ihtiyacın var?</strong><span>Soruların için bize ulaş <ChevronRight size={14}/></span></Link></div></section>
    <NewsletterSignup/>
  </div>;
}
