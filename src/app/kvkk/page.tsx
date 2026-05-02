export const metadata = {
  title: "KVKK Aydınlatma Metni",
};

export default function KvkkPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold text-black mb-6">KVKK Aydınlatma Metni</h1>
      <div className="prose prose-sm text-gray-600 space-y-4">
        <p>
          6698 sayılı Kişisel Verilerin Korunması Kanunu (&quot;KVKK&quot;) kapsamında,
          kişisel verilerinizin işlenmesine ilişkin aydınlatma metni aşağıda yer almaktadır.
        </p>
        <h2 className="text-lg font-semibold text-black">Veri Sorumlusu</h2>
        <p>
          Veri sorumlusu olarak getirbakim.com, kişisel verilerinizi KVKK&apos;nın 5. ve 6. maddelerinde
          belirtilen şartlara uygun olarak işlemektedir.
        </p>
        <h2 className="text-lg font-semibold text-black">İşlenen Kişisel Veriler</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Kimlik bilgileri (ad, soyad)</li>
          <li>İletişim bilgileri (e-posta, telefon)</li>
          <li>İşlem güvenliği bilgileri (IP adresi, log kayıtları)</li>
          <li>Araç ve ürün tercih bilgileri</li>
        </ul>
        <h2 className="text-lg font-semibold text-black">Hukuki Sebebler</h2>
        <p>
          Kişisel verileriniz, açık rızanızın bulunması, bir sözleşmenin ifası,
          meşru menfaatlerimiz ve yasal yükümlülüklerimizin yerine getirilmesi
          hukuki sebeplerine dayanılarak işlenmektedir.
        </p>
        <h2 className="text-lg font-semibold text-black">Haklarınız</h2>
        <p>
          KVKK&apos;nın 11. maddesi kapsamında başvuru hakkına sahipsiniz. Taleplerinizi
          destek@getirbakim.com adresine iletebilirsiniz.
        </p>
      </div>
    </div>
  );
}