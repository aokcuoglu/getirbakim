export const metadata = {
  title: "Gizlilik Politikası",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold text-black mb-6">Gizlilik Politikası</h1>
      <div className="prose prose-sm text-gray-600 space-y-4">
        <p>
          getirbakim.com olarak kişisel verilerinizin güvenliğine önem veriyoruz. Bu gizlilik politikası,
          platformumuz üzerinden toplanan verilerin nasıl kullanıldığını açıklamaktadır.
        </p>
        <h2 className="text-lg font-semibold text-black">Toplanan Veriler</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>İsim, e-posta ve telefon numarası (talep oluşturulduğunda)</li>
          <li>Araç bilgileri (marka, model, yıl)</li>
          <li>Arama geçmişi ve ürün görüntüleme verileri</li>
        </ul>
        <h2 className="text-lg font-semibold text-black">Verilerin Kullanımı</h2>
        <p>
          Kişisel verileriniz yalnızca taleplerinizin işlenmesi, tedarikçi ile iletişim ve
          hizmet kalitesinin artırılması amacıyla kullanılmaktadır.
        </p>
        <h2 className="text-lg font-semibold text-black">Üçüncü Taraflar</h2>
        <p>
          Kişisel verileriniz tedarikçiler ile yalnızca talebinizin yerine getirilmesi amacıyla
          paylaşılır. Verileriniz hiçbir şekilde üçüncü taraflara satılmamaktadır.
        </p>
        <h2 className="text-lg font-semibold text-black">İletişim</h2>
        <p>
          Gizlilik politikası ile ilgili sorularınız için: destek@getirbakim.com
        </p>
      </div>
    </div>
  );
}