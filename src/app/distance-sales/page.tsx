export const metadata = {
  title: "Mesafeli Satış Sözleşmesi",
};

export default function DistanceSalesPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold text-black mb-6">Mesafeli Satış Sözleşmesi</h1>
      <div className="prose prose-sm text-gray-600 space-y-4">
        <h2 className="text-lg font-semibold text-black">1. Taraflar</h2>
        <p>
          <strong>Satıcı:</strong> getirbakim.com&nbsp;&mdash; Açık kaynak yedek parça platformu<br />
          <strong>Alıcı:</strong> Platform üzerinden sipariş veren tüketici
        </p>
        <h2 className="text-lg font-semibold text-black">2. Konu</h2>
        <p>
          Bu sözleşme, getirbakim.com platformu üzerinden gerçekleştirilecek mesafeli satış
          işlemlerinin şartlarını düzenlemektedir.
        </p>
        <h2 className="text-lg font-semibold text-black">3. Ürün ve Fiyat</h2>
        <p>
          Ürün detay sayfasında belirtilen fiyatlar, KDV dahil olarak gösterilmektedir.
          Tedarikçi bazında fiyatlar değişiklik gösterebilir.
        </p>
        <h2 className="text-lg font-semibold text-black">4. Teslimat</h2>
        <p>
          Ürünler, tedarikçi stok durumuna bağlı olarak belirtilen teslimat süresi içinde
          kargoya verilmektedir. Teslimat süreleri tedarikçi teklifinde belirtilmektedir.
        </p>
        <h2 className="text-lg font-semibold text-black">5. Cayma Hakkı</h2>
        <p>
          Tüketici, ürün teslim aldığı tarihten itibaren 14 gün içinde cayma hakkını
          kullanabilir. Cayma bildirimi destek@getirbakim.com adresine yapılmalıdır.
        </p>
        <h2 className="text-lg font-semibold text-black">6. Sorumluluk</h2>
        <p>
          getirbakim.com, tedarikçi ve alıcı arasında aracı platform işlevi görmektedir.
          Ürünün kalitesi, garantisi ve teslimatından ilgili tedarikçi sorumludur.
        </p>
      </div>
    </div>
  );
}