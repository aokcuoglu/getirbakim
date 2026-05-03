import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

export function DealZone() {
  return (
    <section className="bg-gradient-to-r from-primary-dark to-primary">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 sm:py-16">
        <div className="flex flex-col lg:flex-row items-center gap-6 lg:gap-12">
          <div className="flex-1 text-center lg:text-left">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold bg-yellow-400/20 text-yellow-300 px-3 py-1 rounded-full mb-4">
              <Sparkles className="h-3.5 w-3.5" />
              Fırsat Alanı
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">
              Servis & Bakım Parçalarında Fırsat Alanı
            </h2>
            <p className="text-sm sm:text-base text-blue-200 max-w-lg mb-6">
              Filtre, fren ve bakım parçalarında stok/fiyat kontrolüyle hızlı teklif alın.
            </p>
            <Link
              href="/search?q=filtre&inStock=true"
              className="inline-flex items-center gap-2 bg-white text-primary font-semibold px-6 py-3 rounded-lg hover:bg-gray-100 transition-colors text-sm"
            >
              Fırsat Ürünlerini Gör
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="grid grid-cols-3 gap-3 sm:gap-4 w-full lg:w-auto">
            {[
              { label: "Fren", sublabel: "Balata & disk", query: "balata", count: "5K+" },
              { label: "Filtre", sublabel: "Yağ & hava", query: "filtre", count: "3K+" },
              { label: "Motor", sublabel: "Bakım seti", query: "motor", count: "2K+" },
            ].map((item) => (
              <Link
                key={item.query}
                href={`/search?q=${encodeURIComponent(item.query)}&inStock=true`}
                className="group bg-white/10 hover:bg-white/15 border border-white/10 rounded-xl p-4 sm:p-5 text-center transition-colors"
              >
                <p className="text-2xl sm:text-3xl font-bold text-white">{item.count}</p>
                <p className="text-sm font-semibold text-white mt-1">{item.label}</p>
                <p className="text-xs text-blue-200">{item.sublabel}</p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}