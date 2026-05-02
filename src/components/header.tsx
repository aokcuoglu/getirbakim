"use client";

import Link from "next/link";
import { Search, Menu, X } from "lucide-react";
import { useState } from "react";

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="border-b border-gray-200 bg-white sticky top-0 z-50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <Link href="/" className="text-xl font-bold tracking-tight">
            getirbakim<span className="text-gray-400">.com</span>
          </Link>
          <nav className="hidden sm:flex items-center gap-6 text-sm">
            <Link
              href="/"
              className="text-gray-600 hover:text-black transition-colors"
            >
              Ana Sayfa
            </Link>
            <Link
              href="/search?q="
              className="text-gray-600 hover:text-black transition-colors"
            >
              Ürünler
            </Link>
            <Link
              href="/request"
              className="text-gray-600 hover:text-black transition-colors"
            >
              Talep Oluştur
            </Link>
            <Link
              href="/admin/requests"
              className="text-gray-600 hover:text-black transition-colors"
            >
              Admin
            </Link>
          </nav>
          <div className="flex sm:hidden items-center gap-2">
            <Link
              href="/search?q="
              className="p-2 text-gray-600 hover:text-black"
              aria-label="Ara"
            >
              <Search className="h-5 w-5" />
            </Link>
            <button
              className="p-2 text-gray-600 hover:text-black"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Menü"
            >
              {menuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>
      </div>
      {menuOpen && (
        <div className="sm:hidden border-t border-gray-200 bg-white">
          <div className="px-4 py-3 space-y-2">
            <Link
              href="/"
              className="block py-2 text-sm text-gray-600 hover:text-black"
              onClick={() => setMenuOpen(false)}
            >
              Ana Sayfa
            </Link>
            <Link
              href="/search?q="
              className="block py-2 text-sm text-gray-600 hover:text-black"
              onClick={() => setMenuOpen(false)}
            >
              Ürünler
            </Link>
            <Link
              href="/request"
              className="block py-2 text-sm text-gray-600 hover:text-black"
              onClick={() => setMenuOpen(false)}
            >
              Talep Oluştur
            </Link>
            <Link
              href="/admin/requests"
              className="block py-2 text-sm text-gray-600 hover:text-black"
              onClick={() => setMenuOpen(false)}
            >
              Admin
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}