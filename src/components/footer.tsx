import Link from "next/link";
import { SITE_NAME } from "@/lib/storefront";

export function Footer() {
  return (
    <footer className="bg-foreground text-gray-300">
      {/* Disclaimer Banner */}
      <div className="bg-yellow-50 border-b border-yellow-200">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-3">
          <p className="text-xs text-yellow-800 text-center">
            Fiyat ve stok bilgileri talep/sipariş öncesinde tekrar doğrulanır.
          </p>
        </div>
      </div>

      {/* Main Footer */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* Brand */}
          <div>
            <Link href="/" className="inline-block mb-4">
              <span className="text-xl font-bold text-white">{SITE_NAME}</span>
              <span className="text-xl font-light text-gray-400">.com</span>
            </Link>
            <p className="text-sm text-gray-400 leading-relaxed">
              Türkiye&apos;nin yedek parça arama platformu. Birden fazla tedarikçiden fiyat ve stok karşılaştırması.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs bg-gray-800 text-gray-300 px-2.5 py-1 rounded">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse-dot" />
                Katalog aktif
              </span>
            </div>
          </div>

          {/* Kategoriler */}
          <div>
            <h3 className="text-sm font-semibold text-white mb-4">Kategoriler</h3>
            <ul className="space-y-2.5 text-sm">
              <li><Link href="/search?q=fren" className="text-gray-400 hover:text-white transition-colors">Fren</Link></li>
              <li><Link href="/search?q=filtre" className="text-gray-400 hover:text-white transition-colors">Filtre</Link></li>
              <li><Link href="/search?q=motor" className="text-gray-400 hover:text-white transition-colors">Motor</Link></li>
              <li><Link href="/search?q=elektrik" className="text-gray-400 hover:text-white transition-colors">Elektrik</Link></li>
              <li><Link href="/search?q=süspansiyon" className="text-gray-400 hover:text-white transition-colors">Süspansiyon</Link></li>
              <li><Link href="/search?q=aydınlatma" className="text-gray-400 hover:text-white transition-colors">Aydınlatma</Link></li>
            </ul>
          </div>

          {/* Destek */}
          <div>
            <h3 className="text-sm font-semibold text-white mb-4">Destek</h3>
            <ul className="space-y-2.5 text-sm">
              <li><Link href="/kvkk" className="text-gray-400 hover:text-white transition-colors">KVKK Aydınlatma Metni</Link></li>
              <li><Link href="/returns" className="text-gray-400 hover:text-white transition-colors">İade Politikası</Link></li>
              <li><Link href="/distance-sales" className="text-gray-400 hover:text-white transition-colors">Mesafeli Satış Sözleşmesi</Link></li>
              <li><Link href="/privacy" className="text-gray-400 hover:text-white transition-colors">Gizlilik Politikası</Link></li>
              <li><Link href="/request" className="text-gray-400 hover:text-white transition-colors">İletişim</Link></li>
            </ul>
          </div>

          {/* Katalog */}
          <div>
            <h3 className="text-sm font-semibold text-white mb-4">Katalog</h3>
            <ul className="space-y-2.5 text-sm">
              <li><Link href="/search?q=&supplier=Dinamik" className="text-gray-400 hover:text-white transition-colors">Dinamik</Link></li>
              <li><Link href="/search?q=&supplier=SETA" className="text-gray-400 hover:text-white transition-colors">SETA</Link></li>
              <li><Link href="/search?q=&supplier=ParcaTedarik" className="text-gray-400 hover:text-white transition-colors">ParcaTedarik</Link></li>
              <li className="text-gray-500 flex items-center gap-1.5">
                Başbuğ <span className="text-[10px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">Yakında</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-10 pt-6 border-t border-gray-700 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-gray-500">
            &copy; {new Date().getFullYear()} {SITE_NAME}.com &mdash; Açık kaynak yedek parça platformu
          </p>
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <Link href="/kvkk" className="hover:text-gray-300 transition-colors">KVKK</Link>
            <Link href="/privacy" className="hover:text-gray-300 transition-colors">Gizlilik</Link>
            <Link href="/distance-sales" className="hover:text-gray-300 transition-colors">Mesafeli Satış</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}