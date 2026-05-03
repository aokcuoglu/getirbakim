import { HeroSection } from "@/components/hero-section";
import { TrustBenefitRow } from "@/components/trust-benefits";
import { CategoryGrid } from "@/components/category-grid";
import { FeaturedProducts } from "@/components/featured-products";
import { DealZone } from "@/components/deal-zone";
import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex flex-col">
      {/* Hero Section */}
      <HeroSection />

      {/* Trust/Service Benefits */}
      <TrustBenefitRow />

      {/* Category Grid */}
      <CategoryGrid />

      {/* Featured Products */}
      <FeaturedProducts />

      {/* Deal/Promotion Zone */}
      <DealZone />

      {/* How It Works - Simplified */}
      <section className="bg-surface">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground">
              Nasıl Çalışır?
            </h2>
            <p className="text-sm text-muted mt-2">
              3 adımda doğru parçayı bulun ve talep oluşturun.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {[
              { number: "1", title: "Parçayı Ara", description: "OEM numarası, parça kodu veya ürün adı ile arama yapın." },
              { number: "2", title: "Stok ve Fiyatı Karşılaştır", description: "Birden fazla tedarikçinin stok ve fiyat bilgilerini görün." },
              { number: "3", title: "Uyumluluk Teyidiyle Talep Oluştur", description: "Araç uyumluluğunu teyit ederek güvenle talebinizi iletin." },
            ].map((step) => (
              <div key={step.number} className="text-center">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-full border-2 border-accent text-accent font-bold text-lg mb-4">
                  {step.number}
                </div>
                <h3 className="text-sm font-semibold text-foreground mb-2">{step.title}</h3>
                <p className="text-xs text-muted leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-white">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-12 sm:py-16 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-3">
            Aradığınız parçayı bulamadınız mı?
          </h2>
          <p className="text-sm sm:text-base text-muted mb-6 max-w-xl mx-auto">
            Talep oluşturun, sizin için tedarikçilerden fiyat ve stok araştırması yapalım. Uyumluluk teyidi ile yanlış parça riskini azaltalım.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/request?type=quote"
              className="inline-flex items-center gap-2 bg-accent hover:bg-accent-dark text-white px-8 py-3 text-sm font-semibold rounded-lg transition-colors"
            >
              Teklif Al
            </Link>
            <Link
              href="/request?type=compatibility"
              className="inline-flex items-center gap-2 border border-gray-300 text-black px-8 py-3 text-sm font-semibold rounded-lg hover:bg-gray-50 transition-colors"
            >
              Uyumluluğu Kontrol Et
            </Link>
          </div>
          <p className="mt-4 text-xs text-gray-400">
            Telefon ile dönüş yapılacaktır · WhatsApp desteği yakında
          </p>
        </div>
      </section>
    </div>
  );
}