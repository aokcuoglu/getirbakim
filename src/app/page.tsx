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
import "@/styles/catalog.css";
import "@/styles/home.css";

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
  return <div className="store-home">
    <HomeScrollHeader/>
    <section className="catalog-hero home-hero">
      <div className="catalog-hero-note"><Search size={18} aria-hidden="true"/><span>Ürün kodu ve OEM numarasıyla parça arama</span></div>
      <div className="shell"><h1>Yedek parça alışverişi</h1><div className="catalog-vehicle-search">
        <form action="/katalog" className="catalog-code-search" role="search" aria-label="OEM numarasıyla parça ara"><label><span aria-hidden="true">OEM</span><input type="search" name="q" aria-label="Ürün kodu veya OEM numarası" placeholder="Ürün kodu veya OEM numarası" maxLength={120} required/></label><input type="hidden" name="searchBy" value="code"/><button type="submit" aria-label="OEM ile ara"><Search size={20} aria-hidden="true"/></button></form>
        <span className="catalog-search-separator">veya</span><GarageButton vehicle={vehicle} variant="catalog"/>
      </div></div>
    </section>
    <section className="home-category-block">
      <nav className="shell home-main-categories" aria-label="Popüler kategoriler">{categories.map(category=><Link key={category.id} href={"/katalog?category="+category.slug}>{category.imagePath&&<Image src={category.imagePath} width={135} height={90} alt="" unoptimized/>}<span>{category.id===1023?"El aletleri":category.name}</span></Link>)}</nav>
      <div className="shell home-promotions"><HomeCarousel label="Öne çıkan kategoriler">{promotions.map(promotion=>{
        const category=allCategories.find(category=>category.id===promotion.category);
        return <Link className="home-promotion" key={promotion.image} href={promotion.href??(category?"/katalog?category="+category.slug:"/katalog")}><Image src={"/media/trodo/images/"+promotion.image} fill sizes="(max-width:768px) 100vw, (max-width:1350px) 50vw, 656px" alt="" unoptimized/>{promotion.label&&<span className="home-promotion-label">{promotion.label}</span>}<div><h2>{promotion.title}</h2><p>{promotion.description}</p></div></Link>;
      })}</HomeCarousel></div>
      <div className="shell"><HomeCategoryTabs categories={tabCategories}/></div>
    </section>
    {visibleProducts.length>0&&<section className="shell home-products"><div className="home-section-title"><h2>Ürünleri keşfet</h2><Link href="/katalog">Tüm ürünler <ChevronRight size={14}/></Link></div><HomeCarousel kind="products" label="Ürünleri keşfet">{visibleProducts.slice(0,12).map(productCard)}</HomeCarousel></section>}
    {visibleProducts.length>12&&<section className="shell home-products"><div className="home-section-title"><h2>Diğer ürünler</h2><Link href="/katalog">Kataloğa git <ChevronRight size={14}/></Link></div><HomeCarousel kind="products" label="Diğer ürünler">{visibleProducts.slice(12).map(productCard)}</HomeCarousel></section>}
    <section className="shell home-makes"><div className="home-section-title"><h2>Popüler araç markaları</h2><Link href="/automakers">Tüm araç markaları <ChevronRight size={14}/></Link></div><HomeGridPager kind="makes" label="Araç markaları">{makes.map(make=>{const logo=getVehicleLogo(make.name);return <Link key={make.id} href={"/car-parts/"+vehicleBrandSlug(make.name)} aria-label={make.name}>{logo&&<Image src={logo.src} width={logo.width} height={logo.height} alt="" unoptimized/>}<span>{make.name==="VOLKSWAGEN"?"VW":make.name}</span></Link>;})}</HomeGridPager></section>
    <section className="shell home-manufacturers"><div className="home-section-title"><h2>Popüler üreticiler</h2></div><HomeGridPager kind="manufacturers" label="Üreticiler">{manufacturers.map(brand=>{const logo=logos.get(brand);return <Link key={brand} href={"/katalog?brand="+encodeURIComponent(brand)} aria-label={brand}>{logo?<Image src={logo.src} width={logo.width} height={logo.height} alt={brand} unoptimized/>:<span>{brand}</span>}</Link>;})}</HomeGridPager></section>
    <div className="home-collections">{collections.map(collection=>{
      const category=allCategories.find(category=>category.id===collection.categoryId);
      if(!category)return null;
      const children=allCategories.filter(child=>child.parentId===category.id);
      const entries=collection.products.filter(product=>images.has(product.id)&&details.has(product.id));
      return <section className="shell home-collection" key={category.id}><div className="home-section-title"><h2>{category.name}</h2><Link href={"/katalog?category="+category.slug}>Tüm ürünler <ChevronRight size={14}/></Link></div><div className="home-collection-content"><nav aria-label={category.name+" alt kategorileri"}><h3>Öne çıkan kategoriler</h3>{children.slice(0,5).map(child=><Link key={child.id} href={"/katalog?category="+child.slug}>{child.name}</Link>)}</nav><HomeCarousel kind="products" columns={4} label={category.name}>{entries.length?entries.map(productCard):(children.length>5?children.slice(5,15):children).map(child=><Link className="home-collection-card" key={child.id} href={"/katalog?category="+child.slug}>{child.imagePath&&<Image src={child.imagePath} width={180} height={120} alt="" unoptimized/>}<span>{category.name}</span><strong>{child.name}</strong><small>Ürünleri incele <ChevronRight size={14}/></small></Link>)}</HomeCarousel></div></section>;
    })}</div>
    <section className="shell home-about">
      <div className="home-about-intro"><h2>Yedek parça ve bakım ürünleri için online mağazan</h2><p>Getirbakim, aracın için doğru parçayı bulmana yardımcı olan bir <Link href="/katalog">yedek parça</Link> mağazası. Servis deneyimimizi ve tedarik ağımızı internete taşıyor; yedek parçaları, bakım ürünlerini ve ekipmanları tek yerde sunuyoruz. Ürünleri üretici, kategori ve teknik özelliklerine göre inceleyebilir, ürün kodu veya OEM numarasıyla arama yapabilirsin.</p><p>İster aracının bakımını kendin yapıyor ol, ister profesyonel bir serviste çalışıyor ol; parça seçiminde ürün bilgilerini bir arada görmek işini kolaylaştırır. Sipariş vermeden önce OEM numarasını, ölçüleri, montaj konumunu ve araç uyumluluğunu kontrol et.</p></div>
      <Image className="home-about-image" src="/media/trodo/images/Artboard_1-4.jpg" width={1350} height={360} alt="Fren balataları, yağ ve diğer araç bakım parçaları" unoptimized/>
      <h3>Neden Getirbakim?</h3><div className="home-feature-grid">{features.map(feature=><article key={feature.icon}><Image src={"/media/trodo/images/"+feature.icon+".svg"} width={24} height={24} alt="" unoptimized/><h4>{feature.title}</h4><p>{feature.text}</p></article>)}</div>
      <p>Bakım, onarım veya doğru parçayı araştırmak için ihtiyaç duyduğun ürünleri kolayca keşfet. Ürün bilgileri, kategori filtreleri ve garajın bir arada; seçim yaparken parça ve araç bilgilerini birlikte kontrol edebilirsin.</p><p>Bir bakalım, doğru parçayı bulalım.</p>
    </section>
    <section className="home-help"><div className="shell"><Link href="/bilgi/uyumluluk"><strong>Parça uyumluluğunu kontrol et</strong><span>OEM ve araç bilgileriyle seçimini doğrula <ChevronRight size={14}/></span></Link><Link href="/teslimat-ve-iade"><strong>Teslimat ve iade koşulları</strong><span>Sipariş öncesi alışveriş bilgilerini incele <ChevronRight size={14}/></span></Link><Link href="/iletisim"><strong>Yardıma mı ihtiyacın var?</strong><span>Soruların için bize ulaş <ChevronRight size={14}/></span></Link></div></section>
    <NewsletterSignup/>
  </div>;
}
