import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ChevronRight, Wrench } from "lucide-react";
import { redirect } from "next/navigation";
import { categories } from "@/modules/store/catalog";
import { currentVehicle } from "@/modules/store/garage";
import { GarageButton } from "@/components/garage/garage-button";
import { SearchBox } from "@/components/navigation/search-box";

const categoryImages = {
  parts: "3_car_parts.jpg", brakes: "252_brake_system.jpg", filter: "241_filters.jpg",
  oil: "956_oils_and_fluids.jpg", wipers: "607_windscreen_wipers.jpg", tools: "967_accessories_and_equipment.jpg",
};

export default async function Home({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { q } = normalizeSearchParams(await searchParams);
  if (q) redirect(`/katalog?q=${encodeURIComponent(q)}`);
  const vehicle = await currentVehicle();
  return <>
    <section className="store-hero">
      <div className="shell hero-content">
        <p className="hero-kicker">GETİRBAKİM · YEDEK PARÇA</p>
        <h1>Aradığın parçaya<br /><span>birlikte bakalım.</span></h1>
        <p className="hero-description">Araç sahiplerine ve oto servislerine yedek parça. Ürün adı, marka veya OEM koduyla parça ara.</p>
        <SearchBox variant="hero" />
        <div className="hero-garage">
          <GarageButton vehicle={vehicle} variant="hero" />
          <p>Araç bilgilerin elinin altında olsun.<br />Parça uyumluluğunu OEM koduyla ayrıca kontrol et.</p>
        </div>
      </div>
    </section>
    <section className="shell brand-intro"><p className="eyebrow">BİR BAKALIM, DOĞRU PARÇAYI BULALIM.</p><h2>Parçadan anlayan insanların yedek parça mağazası.</h2><p>Servis deneyimimizi ve tedarik ağımızı araç sahipleriyle oto servislerini buluşturmak için internete taşıyoruz.</p><div className="brand-paths"><Link href="/katalog"><strong>Aracım için parça arıyorum</strong><span>Ürün ve OEM koduyla kataloğu incele <ArrowRight size={16}/></span></Link><Link href="/servisler"><strong>Oto servisi işletiyorum</strong><span>Onaylı hesabınla özel fiyatlara ulaş <ArrowRight size={16}/></span></Link></div></section>
    <section className="shell category-showcase" aria-labelledby="home-categories">
      <div className="section-head"><div><span className="eyebrow">KATEGORİLER</span><h2 id="home-categories">Bakımın için ne arıyorsun?</h2></div><Link href="/katalog">Tüm ürünler <ArrowRight size={16} /></Link></div>
      <div className="category-tiles">{categories.map(category => <Link href={`/katalog?category=${category.slug}`} key={category.slug}>
        <div className="category-image-wrap"><Image src={`/media/trodo/images/${categoryImages[category.art]}`} width={135} height={90} alt="" className="category-image" unoptimized /></div>
        <strong>{category.name}</strong><ChevronRight size={15} aria-hidden="true" />
      </Link>)}</div>
    </section>
    <section className="shell home-editorial" aria-labelledby="home-maintenance">
      <div className="section-head"><div><span className="eyebrow">BAKIM ZAMANI</span><h2 id="home-maintenance">Küçük bir bakım, büyük bir fark.</h2></div></div>
      <div className="editorial-grid">
        <Link href="/katalog?category=fren" className="editorial-card"><Image src="/media/trodo/images/w40_brake_discs_web.jpg" fill sizes="(max-width: 600px) calc(100vw - 40px), (max-width: 1280px) 50vw, 592px" alt="Fren diskleri" unoptimized /><div className="editorial-copy"><span className="editorial-eyebrow">FREN SİSTEMİ</span><h3>Her duruşta aracına iyi bak.</h3><span>Fren parçalarını keşfet <ArrowRight size={16} /></span></div></Link>
        <Link href="/katalog?category=fren" className="editorial-card"><Image src="/media/trodo/images/w39_brakepads_web.jpg" fill sizes="(max-width: 600px) calc(100vw - 40px), (max-width: 1280px) 50vw, 592px" alt="Fren balataları" unoptimized /><div className="editorial-copy"><span className="editorial-eyebrow">FREN BAKIMI</span><h3>Her parçanın bir görevi var.</h3><span>Fren balatalarını keşfet <ArrowRight size={16} /></span></div></Link>
      </div>
    </section>
    <section className="shell makes-section">
      <div className="section-head"><div><span className="eyebrow">GARAJIM</span><h2>Aracını bir kez ekle.</h2></div><Link href="/garaj">Garajına git <ArrowRight size={16} /></Link></div>
      <p className="section-description">Marka, model ve yıl bilgilerini kaydet; sonraki ziyaretlerinde kolayca ulaş.</p>
      <div className="make-grid">{["Volkswagen", "BMW", "Mercedes-Benz", "Audi", "Renault", "Ford", "Peugeot", "Toyota"].map(make => <Link key={make} href={`/garaj?make=${encodeURIComponent(make)}`}><strong>{make}</strong><ChevronRight size={14} aria-hidden="true" /></Link>)}</div>
      <p className="subtle">Garaj kaydı ürünleri otomatik filtrelemez. Uyumluluğu ürün kodu ve araç özellikleriyle doğrula.</p>
    </section>
    <section className="shell b2b-banner"><div className="b2b-mark"><Wrench size={28} /></div><div><span>GETİRBAKİM PROFESYONEL</span><h2>Servisinin parça ihtiyacı için güvenilir tedarik.</h2><p>Onaylı B2B hesabınla servisine özel fiyatları görüntüle.</p></div><Link href="/servisler">Servis hesabına başvur <ArrowRight size={18} /></Link></section>
  </>;
}
