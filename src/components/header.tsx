"use client";

import Link from "next/link";
import { Search, Menu, X, User, FileText, ShoppingCart, ChevronDown, Phone, MapPin } from "lucide-react";
import { useState } from "react";
import { NAV_CATEGORIES, SITE_NAME } from "@/lib/storefront";

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [catMenuOpen, setCatMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-white shadow-sm">
      {/* Utility Bar */}
      <div className="bg-primary text-white text-xs">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex items-center justify-between h-8">
          <div className="hidden sm:flex items-center gap-4">
            <Link href="/request" className="hover:text-blue-200 transition-colors">
              Parça bulma desteği
            </Link>
            <span className="text-blue-300">|</span>
            <Link href="/request" className="hover:text-blue-200 transition-colors">
              Sipariş / Talep Takibi
            </Link>
            <span className="text-blue-300">|</span>
            <Link href="/kvkk" className="hover:text-blue-200 transition-colors">
              KVKK
            </Link>
            <span className="text-blue-300">|</span>
            <Link href="/request" className="hover:text-blue-200 transition-colors flex items-center gap-1">
              <Phone className="h-3 w-3" />
              İletişim
            </Link>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-blue-200">
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              Katalog verisi
            </span>
            <span className="text-blue-300">|</span>
            <span>Dinamik · SETA · ParcaTedarik</span>
          </div>
          <div className="sm:hidden text-blue-200">
            <span>Dinamik · SETA · ParcaTedarik</span>
          </div>
        </div>
      </div>

      {/* Main Header */}
      <div className="border-b border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex items-center h-16 gap-4">
          {/* Logo */}
          <Link href="/" className="shrink-0">
            <span className="text-xl font-bold tracking-tight text-foreground">
              {SITE_NAME}
            </span>
            <span className="text-xl font-light text-muted">.com</span>
          </Link>

          {/* Desktop Search */}
          <div className="hidden md:flex flex-1 max-w-2xl mx-auto">
            <form action="/search" method="get" className="w-full">
              <div className="flex items-center border-2 border-primary rounded-lg overflow-hidden focus-within:border-accent transition-colors">
                <input
                  type="text"
                  name="q"
                  placeholder="OEM no, parça kodu, marka veya ürün adı ara"
                  className="flex-1 h-11 px-4 text-sm text-foreground placeholder:text-muted bg-white focus:outline-none"
                />
                <button
                  type="submit"
                  className="flex items-center justify-center h-11 w-14 bg-accent hover:bg-accent-dark text-white transition-colors"
                >
                  <Search className="h-5 w-5" />
                </button>
              </div>
            </form>
          </div>

          {/* Right Icons */}
          <div className="hidden md:flex items-center gap-1">
            <Link
              href="/request"
              className="flex flex-col items-center px-3 py-1.5 text-muted hover:text-foreground transition-colors rounded-lg hover:bg-surface"
            >
              <User className="h-5 w-5" />
              <span className="text-[10px] mt-0.5">Hesabım</span>
            </Link>
            <Link
              href="/request"
              className="flex flex-col items-center px-3 py-1.5 text-muted hover:text-foreground transition-colors rounded-lg hover:bg-surface"
            >
              <FileText className="h-5 w-5" />
              <span className="text-[10px] mt-0.5">Taleplerim</span>
            </Link>
            <button
              disabled
              className="flex flex-col items-center px-3 py-1.5 text-muted/50 cursor-not-allowed relative"
              title="Yakında"
            >
              <ShoppingCart className="h-5 w-5" />
              <span className="text-[10px] mt-0.5">Sepet</span>
              <span className="absolute top-1 right-2 text-[8px] bg-yellow-400 text-yellow-900 px-1 rounded font-bold">Yakında</span>
            </button>
          </div>

          {/* Mobile Menu Buttons */}
          <div className="md:hidden flex items-center gap-2">
            <Link href="/search?q=" className="p-2 text-foreground" aria-label="Ara">
              <Search className="h-5 w-5" />
            </Link>
            <button
              className="p-2 text-foreground"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Menü"
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Navigation Bar */}
      <nav className="hidden md:block border-b border-border bg-surface">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center h-10 gap-0 text-sm font-medium text-foreground overflow-x-auto">
            <div className="relative">
              <button
                onClick={() => setCatMenuOpen(!catMenuOpen)}
                className="flex items-center gap-1 px-4 h-10 bg-primary text-white hover:bg-primary-light transition-colors whitespace-nowrap"
              >
                <Menu className="h-4 w-4" />
                Tüm Kategoriler
                <ChevronDown className={`h-3 w-3 transition-transform ${catMenuOpen ? "rotate-180" : ""}`} />
              </button>
              {catMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setCatMenuOpen(false)} />
                  <div className="absolute left-0 top-10 z-50 w-56 bg-white border border-border shadow-xl rounded-b-lg animate-fade-in">
                    {NAV_CATEGORIES.slice(1).map((cat) => (
                      <Link
                        key={cat.label}
                        href={cat.href}
                        className="block px-4 py-2.5 text-sm text-foreground hover:bg-surface transition-colors border-b border-border last:border-0"
                        onClick={() => setCatMenuOpen(false)}
                      >
                        {cat.label}
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </div>
            {NAV_CATEGORIES.slice(1).map((cat) => (
              <Link
                key={cat.label}
                href={cat.href}
                className="px-3 h-10 flex items-center text-muted hover:text-accent transition-colors whitespace-nowrap"
              >
                {cat.label}
              </Link>
            ))}
          </div>
        </div>
      </nav>

      {/* Mobile Menu */}
      {menuOpen && (
        <div className="md:hidden border-b border-border bg-white animate-fade-in">
          <div className="px-4 py-3 space-y-1">
            {/* Mobile Search */}
            <form action="/search" method="get" className="mb-3">
              <div className="flex items-center border-2 border-primary rounded-lg overflow-hidden">
                <input
                  type="text"
                  name="q"
                  placeholder="Parça ara..."
                  className="flex-1 h-10 px-3 text-sm bg-white focus:outline-none"
                />
                <button type="submit" className="h-10 w-10 bg-accent text-white flex items-center justify-center">
                  <Search className="h-4 w-4" />
                </button>
              </div>
            </form>

            <Link href="/" className="block py-2 text-sm font-medium text-foreground" onClick={() => setMenuOpen(false)}>
              Ana Sayfa
            </Link>
            <Link href="/search?q=" className="block py-2 text-sm text-muted hover:text-foreground" onClick={() => setMenuOpen(false)}>
              Tüm Ürünler
            </Link>

            <div className="pt-2 pb-1">
              <p className="text-xs font-semibold text-muted uppercase tracking-wider">Kategoriler</p>
            </div>
            {NAV_CATEGORIES.slice(1).map((cat) => (
              <Link
                key={cat.label}
                href={cat.href}
                className="block py-1.5 text-sm text-muted hover:text-foreground"
                onClick={() => setMenuOpen(false)}
              >
                {cat.label}
              </Link>
            ))}

            <div className="pt-2 pb-1 border-t border-border mt-2">
              <p className="text-xs font-semibold text-muted uppercase tracking-wider">Hesap</p>
            </div>
            <Link href="/request" className="block py-1.5 text-sm text-muted hover:text-foreground" onClick={() => setMenuOpen(false)}>
              Hesabım
            </Link>
            <Link href="/request" className="block py-1.5 text-sm text-muted hover:text-foreground" onClick={() => setMenuOpen(false)}>
              Taleplerim
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}