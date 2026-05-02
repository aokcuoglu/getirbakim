import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-white mt-auto">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          <div>
            <h3 className="text-sm font-semibold text-black mb-3">getirbakim.com</h3>
            <p className="text-sm text-gray-500">
              Türkiye&apos;nin yedek parça arama platformu. Birden fazla tedarikçiden anlık fiyat ve stok karşılaştırması.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-black mb-3">Yasal</h3>
            <ul className="space-y-2 text-sm text-gray-500">
              <li>
                <Link href="/privacy" className="hover:text-black transition-colors">
                  Gizlilik Politikası
                </Link>
              </li>
              <li>
                <Link href="/kvkk" className="hover:text-black transition-colors">
                  KVKK Aydınlatma Metni
                </Link>
              </li>
              <li>
                <Link href="/distance-sales" className="hover:text-black transition-colors">
                  Mesafeli Satış Sözleşmesi
                </Link>
              </li>
              <li>
                <Link href="/returns" className="hover:text-black transition-colors">
                  İade Politikası
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-black mb-3">Hizmetler</h3>
            <ul className="space-y-2 text-sm text-gray-500">
              <li>
                <Link href="/search?q=" className="hover:text-black transition-colors">
                  Parça Arama
                </Link>
              </li>
              <li>
                <Link href="/request" className="hover:text-black transition-colors">
                  Talep Oluştur
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-black mb-3">İletişim</h3>
            <ul className="space-y-2 text-sm text-gray-500">
              <li>destek@getirbakim.com</li>
            </ul>
          </div>
        </div>
        <div className="mt-8 border-t border-gray-200 pt-4 text-center text-sm text-gray-400">
          &copy; {new Date().getFullYear()} getirbakim.com &mdash; Açık kaynak yedek parça platformu
        </div>
      </div>
    </footer>
  );
}