export const metadata = {
  title: "İade Politikası",
};

export default function ReturnsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold text-black mb-6">İade Politikası</h1>
      <div className="prose prose-sm text-gray-600 space-y-4">
        <h2 className="text-lg font-semibold text-black">İade Hakkı</h2>
        <p>
          6502 sayılı Tüketicinin Korunması Hakkında Kanun kapsamında, mesafeli sözleşmelerde
          ürünleri teslim aldığınız tarihten itibaren 14 gün içinde cayma hakkınızı
          kullanabilirsiniz.
        </p>
        <h2 className="text-lg font-semibold text-black">İade Koşulları</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Ürünlerin orijinal ambalajında ve hasarsız olması</li>
          <li>Fatura veya teslimat belgesinin ibraz edilmesi</li>
          <li>Montaj yapılmamış veya kullanılmamış olması</li>
        </ul>
        <h2 className="text-lg font-semibold text-black">İade Süreci</h2>
        <p>
          İade talebinizi destek@getirbakim.com adresine e-posta ile iletebilirsiniz.
          Talebiniz incelendikten sonra size iade süreci hakkında bilgilendirme yapılacaktır.
        </p>
        <h2 className="text-lg font-semibold text-black">İade Dışı Ürünler</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Özel siparişle üretilen parçalar</li>
          <li>Müşteri tarafından açılmış veya kullanılmış yağlar ve sıvılar</li>
          <li>Elektrik/Elektronik parçaların kutusu açılmış ise</li>
        </ul>
      </div>
    </div>
  );
}