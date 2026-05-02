import { SearchBar } from "@/components/search-bar";
import Link from "next/link";
import { Search, ShieldCheck, BarChart3, Zap } from "lucide-react";

const POPULAR_SEARCHES = [
  "Fren Diski",
  "Yağ Filtresi",
  "Amortisör",
  "Balata",
  "Buji",
  "Radyatör",
];

const TRUST_BADGES = [
  {
    icon: BarChart3,
    title: "Canlı Stok & Fiyat",
    description: "Tedarikçi stok ve fiyatları anlık olarak güncellenir.",
  },
  {
    icon: Search,
    title: "OEM/OEN Arama",
    description: "Orijinal parça numarasıyla doğru ürünü bulun.",
  },
  {
    icon: ShieldCheck,
    title: "Uyumluluk Teyidi",
    description: "Sipariş öncesi araç uyumluluğunu teyit edin.",
  },
  {
    icon: Zap,
    title: "Hızlı Talep",
    description: "Bulduğunuz parça için hızlıca talep oluşturun.",
  },
];

const STEPS = [
  {
    number: "1",
    title: "Parçayı Ara",
    description:
      "OEM numarası, parça kodu veya ürün adı ile arama yapın.",
  },
  {
    number: "2",
    title: "Stok ve Fiyatı Karşılaştır",
    description:
      "Birden fazla tedarikçinin canlı stok ve fiyat bilgilerini görün.",
  },
  {
    number: "3",
    title: "Uyumluluk Teyidiyle Talep Oluştur",
    description:
      "Araç uyumluluğunu teyit ederek güvenle talebinizi iletin.",
  },
];

export default function HomePage() {
  return (
    <div className="flex flex-col">
      <section className="bg-black text-white">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:py-24 text-center">
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight leading-tight mb-4">
            Aradığın yedek parçayı canlı stok ve fiyat bilgisiyle bul.
          </h1>
          <p className="text-gray-400 text-base sm:text-lg max-w-2xl mx-auto mb-8">
            OEM no, parça kodu veya ürün adı ile tedarikçi stoklarını karşılaştır.
          </p>
          <div className="max-w-2xl mx-auto mb-6">
            <SearchBar size="lg" />
          </div>
          <div className="flex flex-wrap justify-center gap-2 mt-4">
            {POPULAR_SEARCHES.map((term) => (
              <Link
                key={term}
                href={`/search?q=${encodeURIComponent(term)}`}
                className="text-xs bg-white/10 hover:bg-white/20 text-gray-300 px-3 py-1.5 rounded-full transition-colors"
              >
                {term}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white border-b border-gray-200">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
            {TRUST_BADGES.map((badge) => (
              <div key={badge.title} className="text-center sm:text-left">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-gray-100 mb-3">
                  <badge.icon className="h-5 w-5 text-black" />
                </div>
                <h3 className="text-sm font-semibold text-black mb-1">
                  {badge.title}
                </h3>
                <p className="text-xs text-gray-500 leading-relaxed">
                  {badge.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-gray-50">
        <div className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-black">
              Nasıl Çalışır?
            </h2>
            <p className="text-gray-500 text-sm mt-2">
              3 adımda doğru parçayı bulun ve talep oluşturun.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {STEPS.map((step) => (
              <div key={step.number} className="text-center">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-full border-2 border-black text-black font-bold text-lg mb-4">
                  {step.number}
                </div>
                <h3 className="text-sm font-semibold text-black mb-2">
                  {step.title}
                </h3>
                <p className="text-xs text-gray-500 leading-relaxed">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-4xl px-4 py-12 sm:py-16 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-black mb-3">
            Aradığınız parçayı bulamadınız mı?
          </h2>
          <p className="text-gray-500 text-sm sm:text-base mb-6 max-w-xl mx-auto">
            Talep oluşturun, sizin için tedarikçilerden fiyat ve stok araştırması yapalım.
          </p>
          <Link
            href="/request"
            className="inline-block bg-black text-white px-8 py-3 text-sm font-medium hover:bg-gray-800 transition-colors rounded"
          >
            Parça Bulamadım
          </Link>
        </div>
      </section>
    </div>
  );
}