"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ArrowRight } from "lucide-react";
import { HERO_SEARCH_EXAMPLES } from "@/lib/storefront";
import Link from "next/link";

export function HeroSection() {
  const [query, setQuery] = useState("");
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  }

  return (
    <section className="relative bg-gradient-to-br from-primary-dark via-primary to-primary-light overflow-hidden">
      {/* Subtle background pattern */}
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")" }} />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16 sm:py-24 lg:py-32">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white tracking-tight leading-tight mb-4">
            Aradığın yedek parçayı hızlıca bul
          </h1>
          <p className="text-base sm:text-lg text-blue-200 max-w-2xl mx-auto mb-8">
            OEM no, ürün kodu veya parça adı ile 390 binden fazla katalog ürününde arama yap.
          </p>

          {/* Hero Search */}
          <form onSubmit={handleSubmit} className="max-w-2xl mx-auto mb-6">
            <div className="flex items-center bg-white rounded-xl shadow-xl overflow-hidden">
              <div className="flex items-center pl-4 text-muted">
                <Search className="h-5 w-5" />
              </div>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="OEM no, parça kodu, marka veya ürün adı ara"
                className="flex-1 h-14 px-3 text-base text-foreground placeholder:text-muted bg-transparent focus:outline-none"
              />
              <button
                type="submit"
                className="h-14 px-6 bg-accent hover:bg-accent-dark text-white font-semibold transition-colors flex items-center gap-2 shrink-0"
              >
                <Search className="h-5 w-5" />
                <span className="hidden sm:inline">Parça Ara</span>
              </button>
            </div>
          </form>

          {/* Search Examples */}
          <div className="flex flex-wrap justify-center gap-2 mb-8">
            {HERO_SEARCH_EXAMPLES.map((ex) => (
              <Link
                key={ex.query}
                href={`/search?q=${encodeURIComponent(ex.query)}`}
                className="text-xs bg-white/10 hover:bg-white/20 text-blue-100 px-3 py-1.5 rounded-full transition-colors border border-white/20"
              >
                {ex.label}
              </Link>
            ))}
            <span className="text-xs text-blue-300 self-center">|</span>
            <Link
              href="/search?q=BV6Z3504WT"
              className="text-xs bg-white/10 hover:bg-white/20 text-blue-100 px-3 py-1.5 rounded-full transition-colors border border-white/20"
            >
              OEM no ile ara
            </Link>
            <Link
              href="/search?q=ANKA%2020100020"
              className="text-xs bg-white/10 hover:bg-white/20 text-blue-100 px-3 py-1.5 rounded-full transition-colors border border-white/20"
            >
              ürün kodu ile ara
            </Link>
          </div>

          {/* Secondary CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-10">
            <Link
              href="/request"
              className="inline-flex items-center gap-2 text-sm text-blue-200 hover:text-white transition-colors border border-white/20 rounded-lg px-4 py-2 hover:bg-white/10"
            >
              Parça bulamadım
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {/* Vehicle Selector Placeholder */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-6 max-w-2xl mx-auto backdrop-blur-sm">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div>
                <label className="block text-[10px] text-blue-300 uppercase tracking-wider mb-1.5 text-left">Marka</label>
                <div className="bg-white/10 border border-white/20 rounded-lg h-10 flex items-center px-3 text-sm text-blue-200/60">
                  Marka Seç
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-blue-300 uppercase tracking-wider mb-1.5 text-left">Model</label>
                <div className="bg-white/10 border border-white/20 rounded-lg h-10 flex items-center px-3 text-sm text-blue-200/60">
                  Model Seç
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-blue-300 uppercase tracking-wider mb-1.5 text-left">Yıl</label>
                <div className="bg-white/10 border border-white/20 rounded-lg h-10 flex items-center px-3 text-sm text-blue-200/60">
                  Yıl Seç
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-blue-300 uppercase tracking-wider mb-1.5 text-left">Motor</label>
                <div className="bg-white/10 border border-white/20 rounded-lg h-10 flex items-center px-3 text-sm text-blue-200/60">
                  Motor Seç
                </div>
              </div>
            </div>
            <button
              disabled
              className="w-full h-10 bg-white/10 border border-white/20 rounded-lg text-sm text-blue-200/60 cursor-not-allowed"
            >
              Araca Göre Ara — Yakında
            </button>
            <p className="text-[10px] text-blue-300/70 mt-2.5 text-center leading-relaxed">
              Şimdilik OEM no, ürün kodu ve parça adı ile arama desteklenir. Araç uyumluluğu sonraki fazda aktif edilecektir.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}