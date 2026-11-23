import {normalizeSearchParams,type SearchParams} from "@/lib/search-params";
import {redirect} from "next/navigation";
import {getStoreCategories} from "@/modules/store/categories";
import {currentVehicle} from "@/modules/store/garage";
import {shownVehicle} from "@/modules/store/vehicle-label";
import {currentAccount} from "@/modules/auth/session";
import {GarageButton} from "@/components/garage/garage-button";
import {HeroBackdrop} from "@/components/hero-backdrop";
import {HomeMakeTile,HomeBrandTile} from "@/components/home-tiles";
import {homeCategoryTabs,homeCollectionSize,homeRailSize,spreadByBrand} from "@/modules/store/home-rail";
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
import {HomeStatic} from "@/components/home-static";
import {homeHero} from "@/content/home";
import {cn} from "@/lib/utils";
import heroMobile from "@/assets/hero/Hero_image-mobile.webp";
import hero1920 from "@/assets/hero/Hero_image-1920.webp";
import hero3840 from "@/assets/hero/Hero_image-3840.webp";
import {homeTitle,pageMetadata,siteDescription} from "@/lib/site";
import {catalogPath,categoryPath,makePath,makesPath,searchPath} from "@/modules/seo/paths";

const manufacturerOrder=["BOSCH","FEBI","LUK","SKF","GATES","SACHS","FAG","MANN","TRW","LEMFORDER","DENSO","CONTITECH","ELRING","MOOG","PIERBURG","CTR","VALEO","INA","BLUE PRINT","LESJOFORS","DELPHI","HELLA","MAHLE","NGK","DAYCO","NRF","DEPO","PURFLUX","HENGST","ATE","BERU","CHAMPION","FERODO","JURID","TEXTAR","CORTECO","BORGWARNER","GARRETT","NTN-SNR","AISIN","GKN","STABILUS","VERNET","UFI","SHELL","TOTAL","OSRAM","VDO"];

const shell="mx-auto w-full max-w-[1350px] px-[15px]";

export const metadata=pageMetadata({title:homeTitle,absoluteTitle:true,description:siteDescription,path:"/"});

export default async function Home({searchParams}:{searchParams:Promise<SearchParams>}) {
  const {q}=normalizeSearchParams(await searchParams);
  if(q)redirect(searchPath({q}));
  const [vehicle,allCategories,vehicleBrands,brands,products,account,collections,directory]=await Promise.all([currentVehicle(),getStoreCategories(),getVehicleBrands(),catalogBrands(),getHomeProducts(),currentAccount(),Promise.all([967,1023,11058].map(async categoryId=>({categoryId,products:await getHomeProducts(categoryId)}))),manufacturerDirectory()]);
  const tabs=homeCategoryTabs(allCategories);
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
      <div className={shell}><HomeCategoryTabs roots={tabs.roots} initial={tabs.initial}/></div>
    </section>
    {visibleProducts.length>0&&<section className={cn(shell,"mb-[30px] pb-[45px] max-md:mb-10")}><HomeStatic part="title" title="Ürünleri keşfet" note href={catalogPath} link="Tüm ürünler"/><HomeCarousel label="Ürünleri keşfet">{visibleProducts.slice(0,homeRailSize).map(productCard)}</HomeCarousel></section>}
    {visibleProducts.length>homeRailSize&&<section className={cn(shell,"mb-[30px] pb-[45px] max-md:mb-10")}><HomeStatic part="title" title="Diğer ürünler" note href={catalogPath} link="Kataloğa git"/><HomeCarousel label="Diğer ürünler">{visibleProducts.slice(homeRailSize,2*homeRailSize).map(productCard)}</HomeCarousel></section>}
    <section className={cn(shell,"mt-[60px] pb-12 max-md:mt-10 max-md:pb-14")}><HomeStatic part="title" title="Popüler araç markaları" centered href={makesPath} link="Tüm araç markaları"/><HomeGridPager kind="makes" label="Araç markaları">{makes.map(make=>{const logo=getVehicleLogo(make.name);return <HomeMakeTile key={make.id} href={makePath(vehicleBrandSlug(make.name))} label={vehicleMakeLabel(make.name)} logo={logo?[logo.src,logo.width,logo.height]:undefined}/>;})}</HomeGridPager></section>
    <section className={cn(shell,"mt-[60px] pb-12 max-md:mt-10 max-md:pb-14")}><HomeStatic part="title" title="Popüler üreticiler" centered className="mb-10 max-md:mb-6"/><HomeGridPager kind="manufacturers" label="Üreticiler">{manufacturers.map(({brand,href})=>{const logo=logos.get(brand);return <HomeBrandTile key={brand} href={href} brand={brand} logo={logo?[logo.src,logo.width,logo.height]:undefined}/>;})}</HomeGridPager></section>
    <div className="mt-[60px] max-md:mt-10">{collections.map(collection=>{
      const category=allCategories.find(category=>category.id===collection.categoryId);
      if(!category)return null;
      const children=allCategories.filter(child=>child.parentId===category.id);
      const entries=spreadByBrand(collection.products.filter(product=>images.has(product.id)&&details.has(product.id)),2).slice(0,homeCollectionSize);
      return <section className={cn(shell,"mb-[60px] pb-[45px] max-md:mb-10")} key={category.id}><HomeStatic part="title" title={category.name} note={entries.length>0} href={categoryPath(category.slug)} link="Tüm ürünler"/><div className="grid grid-cols-[220px_minmax(0,1fr)] gap-4 max-md:grid-cols-1"><HomeStatic part="nav" name={category.name} links={children.slice(0,5).map((child):[string,string]=>[child.name,child.slug])}/><HomeCarousel columns={4} label={category.name}>{entries.length?entries.map(productCard):(children.length>5?children.slice(5,15):children).map(child=><HomeStatic key={child.id} part="category" parent={category.name} name={child.name} slug={child.slug} image={child.imagePath}/>)}</HomeCarousel></div></section>;
    })}</div>
    <HomeStatic part="about"/>
    <HomeStatic part="help"/>
    <NewsletterSignup/>
  </div>;
}
