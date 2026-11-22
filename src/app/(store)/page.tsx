import {normalizeSearchParams,type SearchParams} from "@/lib/search-params";
import Image from "next/image";
import Link from "next/link";
import {ChevronRight} from "lucide-react";
import {redirect} from "next/navigation";
import {getStoreCategories} from "@/modules/store/categories";
import {currentVehicle} from "@/modules/store/garage";
import {shownVehicle} from "@/modules/store/vehicle-label";
import {currentAccount} from "@/modules/auth/session";
import {GarageButton} from "@/components/garage/garage-button";
import {HeroBackdrop} from "@/components/hero-backdrop";
import {HomeMakeTile,HomeBrandTile} from "@/components/home-tiles";
import {homeCollectionSize,homeRailSize,spreadByBrand} from "@/modules/store/home-rail";
import {HomeCarousel,HomeCategoryTabs,HomeGridPager,HomeScrollHeader} from "@/components/home-controls";
import {getVehicleBrands} from "@/modules/store/vehicle-catalog.server";
import {vehicleBrandSlug,popularVehicleMakes} from "@/modules/store/vehicle-catalog";
import {catalogBrands} from "@/modules/store/catalog";
import {manufacturerDirectory} from "@/modules/store/manufacturers.server";
import {featuredManufacturers} from "@/modules/store/manufacturers";
import {getHomeProducts,getHomeProductCategories} from "@/modules/store/home";
import {getCatalogProductDetails,getCatalogProductImages} from "@/modules/store/product-enrichment";
import {getManufacturerLogos} from "@/modules/store/manufacturer-logos";
import {getVehicleLogo} from "@/modules/store/storefront-logos";
import {vehicleMakeLabel} from "@/modules/store/vehicle-model-groups";
import {HomeProductCard} from "@/components/home-product-card";
import {NewsletterSignup} from "@/components/newsletter-signup";
import {HomeFeaturedCards,HomeTrustLine} from "@/components/home-highlights";
import {homeHero} from "@/content/home";
import {cn} from "@/lib/utils";
import heroMobile from "@/assets/hero/Hero_image-mobile.webp";
import hero1920 from "@/assets/hero/Hero_image-1920.webp";
import hero3840 from "@/assets/hero/Hero_image-3840.webp";
import {homeTitle,pageMetadata,siteDescription} from "@/lib/site";
import {catalogPath,categoryPath,makePath,makesPath,searchPath} from "@/modules/seo/paths";

const manufacturerOrder=["BOSCH","FEBI","LUK","SKF","GATES","SACHS","FAG","MANN","TRW","LEMFORDER","DENSO","CONTITECH","ELRING","MOOG","PIERBURG","CTR","VALEO","INA","BLUE PRINT","LESJOFORS","DELPHI","HELLA","MAHLE","NGK","DAYCO","NRF","DEPO","PURFLUX","HENGST","ATE","BERU","CHAMPION","FERODO","JURID","TEXTAR","CORTECO","BORGWARNER","GARRETT","NTN-SNR","AISIN","GKN","STABILUS","VERNET","UFI","SHELL","TOTAL","OSRAM","VDO"];
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
const taxNote=<p className="mt-1 text-[13px] leading-5 text-muted-foreground">Fiyatlar KDV dahil · Kargo hariç</p>;
const sectionTitle="mb-8 flex items-center justify-between gap-4 [&_h2]:m-0";
const centeredTitle="mb-8 text-center [&_h2]:mb-2";
const titleLink="inline-flex items-center gap-2 text-sm leading-5 font-medium text-brand max-md:text-[13px] max-md:whitespace-nowrap";
const h2="text-[28px] leading-[34px] font-semibold tracking-[-.5px] max-md:text-[22px] max-md:leading-7";

export const metadata=pageMetadata({title:homeTitle,absoluteTitle:true,description:siteDescription,path:"/"});

export default async function Home({searchParams}:{searchParams:Promise<SearchParams>}) {
  const {q}=normalizeSearchParams(await searchParams);
  if(q)redirect(searchPath({q}));
  const [vehicle,allCategories,vehicleBrands,brands,products,account,collections,directory]=await Promise.all([currentVehicle(),getStoreCategories(),getVehicleBrands(),catalogBrands(),getHomeProducts(),currentAccount(),Promise.all([967,1023,11058].map(async categoryId=>({categoryId,products:await getHomeProducts(categoryId)}))),manufacturerDirectory()]);
  const tabRoots=allCategories.filter(category=>category.parentId===null).map(({id,name})=>({id,name,children:allCategories.filter(child=>child.parentId===id).map(({id,name,slug,imagePath})=>({id,name,slug,imagePath}))}));
  const makes=popularVehicleMakes.flatMap(name=>vehicleBrands.filter(brand=>brand.name===name));
  // Each entry links its manufacturer page under the master brand name (#660, #811); one without a page is left out.
  const manufacturers=featuredManufacturers(manufacturerOrder,brands,directory);
  const allProducts=[...new Map([...products,...collections.flatMap(collection=>collection.products)].map(product=>[product.id,product])).values()];
  const [logos,images,details,productCategories]=await Promise.all([getManufacturerLogos(manufacturers.map(({brand})=>brand)),getCatalogProductImages(allProducts),getCatalogProductDetails(allProducts),getHomeProductCategories(allProducts)]);
  const visibleProducts=spreadByBrand(products.filter(product=>images.has(product.id)&&details.has(product.id)),2);
  const productCard=(product:typeof products[number])=><HomeProductCard key={product.id} product={product} image={images.get(product.id)} partNumber={details.get(product.id)?.partNumber} category={productCategories.get(product.id)} account={account}/>;
  return <div className="bg-white text-foreground">
    <HomeScrollHeader/>
    <section className="relative flow-root min-h-[280px] bg-[#212b36] py-10 text-white max-[37.5rem]:min-h-[200px] max-[37.5rem]:py-6">
      <HeroBackdrop mobile={heroMobile} desktop={hero1920} desktop2x={hero3840}/>
      <div className="relative mx-auto flex w-full max-w-[1384px] flex-col items-center px-8 text-center max-[37.5rem]:px-4"><h1 className="mb-3 max-w-[820px] text-[34px] leading-[42px] font-semibold tracking-[-.7px] text-balance max-[37.5rem]:text-2xl max-[37.5rem]:leading-[32px]">{homeHero.title}</h1><p className="mb-6 max-w-[640px] text-base leading-6 text-white/85 max-[37.5rem]:mb-5 max-[37.5rem]:text-sm max-[37.5rem]:leading-5">{homeHero.lead}</p>
        <GarageButton vehicle={shownVehicle(vehicle)} variant="home"/>
      </div>
    </section>
    <HomeTrustLine/>
    <section className="mb-[87px] bg-[#fafafa] pt-14 pb-[77px] max-md:mb-12 max-md:pt-10 max-md:pb-12">
      <div className={cn(shell,"mt-0")}><HomeFeaturedCards categories={allCategories}/></div>
      <div className={shell}><HomeCategoryTabs roots={tabRoots}/></div>
    </section>
    {visibleProducts.length>0&&<section className={cn(shell,"mb-[30px] pb-[45px] max-md:mb-10")}><div className={sectionTitle}><div><h2 className={h2}>Ürünleri keşfet</h2>{taxNote}</div><Link href={catalogPath} className={titleLink}>Tüm ürünler <ChevronRight size={14}/></Link></div><HomeCarousel label="Ürünleri keşfet">{visibleProducts.slice(0,homeRailSize).map(productCard)}</HomeCarousel></section>}
    {visibleProducts.length>homeRailSize&&<section className={cn(shell,"mb-[30px] pb-[45px] max-md:mb-10")}><div className={sectionTitle}><div><h2 className={h2}>Diğer ürünler</h2>{taxNote}</div><Link href={catalogPath} className={titleLink}>Kataloğa git <ChevronRight size={14}/></Link></div><HomeCarousel label="Diğer ürünler">{visibleProducts.slice(homeRailSize,2*homeRailSize).map(productCard)}</HomeCarousel></section>}
    <section className={cn(shell,"mt-[60px] pb-12 max-md:mt-10 max-md:pb-14")}><div className={centeredTitle}><h2 className={h2}>Popüler araç markaları</h2><Link href={makesPath} className={titleLink}>Tüm araç markaları <ChevronRight size={14}/></Link></div><HomeGridPager kind="makes" label="Araç markaları">{makes.map(make=>{const logo=getVehicleLogo(make.name);return <HomeMakeTile key={make.id} href={makePath(vehicleBrandSlug(make.name))} label={vehicleMakeLabel(make.name)} logo={logo?[logo.src,logo.width,logo.height]:undefined}/>;})}</HomeGridPager></section>
    <section className={cn(shell,"mt-[60px] pb-12 max-md:mt-10 max-md:pb-14")}><div className={cn(centeredTitle,"mb-10 max-md:mb-6")}><h2 className={h2}>Popüler üreticiler</h2></div><HomeGridPager kind="manufacturers" label="Üreticiler">{manufacturers.map(({brand,href})=>{const logo=logos.get(brand);return <HomeBrandTile key={brand} href={href} brand={brand} logo={logo?[logo.src,logo.width,logo.height]:undefined}/>;})}</HomeGridPager></section>
    <div className="mt-[60px] max-md:mt-10">{collections.map(collection=>{
      const category=allCategories.find(category=>category.id===collection.categoryId);
      if(!category)return null;
      const children=allCategories.filter(child=>child.parentId===category.id);
      const entries=spreadByBrand(collection.products.filter(product=>images.has(product.id)&&details.has(product.id)),2).slice(0,homeCollectionSize);
      return <section className={cn(shell,"mb-[60px] pb-[45px] max-md:mb-10")} key={category.id}><div className={sectionTitle}><div><h2 className={h2}>{category.name}</h2>{entries.length>0&&taxNote}</div><Link href={categoryPath(category.slug)} className={titleLink}>Tüm ürünler <ChevronRight size={14}/></Link></div><div className="grid grid-cols-[220px_minmax(0,1fr)] gap-4 max-md:grid-cols-1"><nav aria-label={category.name+" alt kategorileri"} className="min-h-[330px] self-start rounded-md border border-[#dfe3e8] p-5 max-md:min-h-0 max-md:p-4"><h3 className="mb-4 text-base leading-6 font-medium max-md:mb-3">Öne çıkan kategoriler</h3>{children.slice(0,5).map(child=><Link key={child.id} href={categoryPath(child.slug)} className="mb-4 block text-sm leading-5 text-[#54626e] last:mb-0 hover:text-primary max-md:mr-4 max-md:mb-2 max-md:inline-block max-md:text-[13px]">{child.name}</Link>)}</nav><HomeCarousel columns={4} label={category.name}>{entries.length?entries.map(productCard):(children.length>5?children.slice(5,15):children).map(child=><Link className="flex h-[360px] min-w-0 flex-col text-foreground max-md:h-80 max-[37.5rem]:h-[300px]" key={child.id} href={categoryPath(child.slug)}>{child.imagePath&&<Image src={child.imagePath} width={180} height={120} alt="" className="mx-auto mb-[30px] h-[180px] w-[180px] max-w-full object-contain max-md:mb-5 max-md:size-[170px] max-[37.5rem]:size-[150px]"/>}<span className="mb-[5px] truncate text-[13px] leading-[19.5px] text-muted-foreground">{category.name}</span><strong className="line-clamp-3 text-sm leading-5 font-medium">{child.name}</strong><small className="mt-auto flex items-center gap-2 pb-[22px] text-[13px] leading-5 text-brand">Ürünleri incele <ChevronRight size={14}/></small></Link>)}</HomeCarousel></div></section>;
    })}</div>
    <section className={cn(shell,"mt-12 mb-[72px] max-w-[930px] text-sm leading-5 text-[#54626e] max-md:mt-8 max-md:mb-12 [&>p]:mb-5 max-md:[&>p]:mb-4 [&>p:last-child]:mb-0")}>
      <div className="mb-10 max-md:mb-8 [&>p]:mb-5 max-md:[&>p]:mb-4"><h2 className={cn(h2,"mb-5 text-foreground")}>Yedek parça ve bakım ürünleri için online mağazan</h2><p>Getirbakim, aracın için doğru parçayı bulmana yardımcı olan bir <Link href={catalogPath} className="font-medium text-primary">yedek parça</Link> mağazası. Servis deneyimimizi ve tedarik ağımızı internete taşıyor; yedek parçaları, bakım ürünlerini ve ekipmanları tek yerde sunuyoruz. Ürünleri üretici, kategori ve teknik özelliklerine göre inceleyebilir, ürün kodu veya OEM numarasıyla arama yapabilirsin.</p><p>İster aracının bakımını kendin yapıyor ol, ister profesyonel bir serviste çalışıyor ol; parça seçiminde ürün bilgilerini bir arada görmek işini kolaylaştırır. Sipariş vermeden önce OEM numarasını, ölçüleri, montaj konumunu ve araç uyumluluğunu kontrol et.</p></div>
      <Image className="mb-14 aspect-[3.75] h-auto w-full rounded-[10px] object-cover max-md:mb-10 max-md:aspect-[2.5]" src="/media/site/images/Artboard_1-4.jpg" width={1350} height={360} alt="Fren balataları, yağ ve diğer araç bakım parçaları" unoptimized/>
      <h3 className="mb-8 text-[23px] leading-[29px] font-semibold tracking-[-.5px] text-foreground max-md:mb-6 max-md:text-xl max-md:leading-[26px]">Neden Getirbakim?</h3><div className="mb-12 grid grid-cols-3 gap-4 max-md:grid-cols-2 max-[37.5rem]:grid-cols-1">{features.map(feature=><article key={feature.icon} className="relative rounded-md border border-border py-5 pr-5 pl-14 max-md:py-4 max-md:pr-4 max-md:pl-[52px]"><Image src={"/media/site/images/"+feature.icon+".svg"} width={24} height={24} alt="" unoptimized className="absolute top-5 left-5 max-md:top-4 max-md:left-4"/><h4 className="mb-2 text-base leading-6 font-medium text-foreground">{feature.title}</h4><p className="text-[13px] leading-[18px] text-pretty max-md:mb-4">{feature.text}</p></article>)}</div>
      <p>Bakım, onarım veya doğru parçayı araştırmak için ihtiyaç duyduğun ürünleri kolayca keşfet. Ürün bilgileri, kategori filtreleri ve garajın bir arada; seçim yaparken parça ve araç bilgilerini birlikte kontrol edebilirsin.</p><p>Bir bakalım, doğru parçayı bulalım.</p>
    </section>
    <section className="border-t border-[#dfe3e8] py-12 max-md:py-6"><div className={cn(shell,"grid grid-cols-2 gap-8 lg:grid-cols-4 max-md:grid-cols-1 max-md:gap-2 [&>a]:py-4 [&_strong]:mb-2 [&_strong]:block [&_strong]:text-base [&_strong]:leading-6 [&_strong]:font-medium [&_span]:flex [&_span]:items-center [&_span]:gap-2 [&_span]:text-[13px] [&_span]:leading-[18px] [&_span]:text-[#54626e]")}><Link href="/bilgi/uyumluluk"><strong>Parça uyumluluğunu kontrol et</strong><span>OEM ve araç bilgileriyle seçimini doğrula <ChevronRight size={14}/></span></Link><Link href="/teslimat-ve-iade"><strong>Teslimat ve iade koşulları</strong><span>Sipariş öncesi alışveriş bilgilerini incele <ChevronRight size={14}/></span></Link><Link href="/rehber"><strong>Rehber</strong><span>Kısa yanıtlarla parça seçimini öğren <ChevronRight size={14}/></span></Link><Link href="/iletisim"><strong>Yardıma mı ihtiyacın var?</strong><span>Soruların için bize ulaş <ChevronRight size={14}/></span></Link></div></section>
    <NewsletterSignup/>
  </div>;
}
