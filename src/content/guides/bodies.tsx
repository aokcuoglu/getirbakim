import Link from "next/link";

const tableWrap = "my-5 overflow-x-auto";

function OemNumber() {
  return <>
    <h2>OEM numarası ne anlama gelir?</h2>
    <p>OEM, “Original Equipment Manufacturer” (orijinal ekipman üreticisi) ifadesinin kısaltmasıdır. Yedek parça dünyasında OEM numarası, bir parçayı araç veya parça üreticisinin kendi kataloğunda tanımlayan referans numarasıdır. Aynı numara üzerinden farklı üreticilerin ürettiği muadil parçalar da aranabilir.</p>
    <p>Bu yüzden OEM numarası, ürün adı ve marka bilgisinden daha kesin bir arama anahtarıdır. Ürün adları markadan markaya değişir, numara ise parçayı tarif eder.</p>

    <h2>OEM numarası ile ürün kodu aynı şey midir?</h2>
    <p>Hayır. Ürün kodu, parçayı üreten markanın kendi numarasıdır; OEM numarası ise aracı veya parçayı ilk üreten firmanın referansıdır. Bir ürünün birden fazla OEM numarası olabilir, bir OEM numarası da farklı markaların ürünlerine karşılık gelebilir.</p>
    <div className={tableWrap} tabIndex={0} role="region" aria-label="Tablo">
      <table>
        <thead><tr><th scope="col">Numara</th><th scope="col">Kimin numarası</th><th scope="col">Nerede görülür</th></tr></thead>
        <tbody>
          <tr><th scope="row">Ürün kodu</th><td>Parçayı üreten marka</td><td>Parça, kutu ve ürün sayfası</td></tr>
          <tr><th scope="row">OEM numarası</th><td>Araç veya parça üreticisinin kataloğu</td><td>Eski parça, üretici kataloğu ve ürün sayfasındaki OEM listesi</td></tr>
        </tbody>
      </table>
    </div>

    <h2>OEM numarasını nereden bulursun?</h2>
    <ul>
      <li>Aracından çıkan eski parçanın üzerinde yazan numaralara bak. Bazı parçalarda numara basılı veya etiketlidir; bazılarında okunmayacak kadar silinmiş olabilir.</li>
      <li>Araç üreticisinin parça kataloğunda aracının bilgileriyle ilgili parçayı bul. Katalogda araç tanımı için genellikle şasi numarası kullanılır; şasi numarası araç ruhsatında yazar.</li>
      <li>Ürün sayfasındaki OEM numaralarını, elindeki numarayla karşılaştır.</li>
      <li>Emin olamıyorsan parçanın fotoğrafını ve araç bilgilerini bize ilet; birlikte bakalım.</li>
    </ul>

    <h2>OEM numarasıyla Getirbakim’de nasıl ararsın?</h2>
    <p>Üstteki arama alanına numarayı, parçada yazdığı biçimde gir. Arama ürün adının yanı sıra ürün koduna ve OEM numarasına da bakar. Sonuç listesinde ürün sayfasını açıp OEM numaralarını ve uyumlu araç listesini kontrol et. Araç bilgilerini <Link href="/garaj">Garajım</Link> alanına eklersen katalog o araca göre filtrelenir.</p>

    <h2>OEM numarası uyumluluğu garanti eder mi?</h2>
    <p>Hayır. Aynı model adı altında farklı motor, üretim yılı ve donanım seçenekleri bulunur ve bunlarda farklı parçalar kullanılabilir. OEM numarasını; motor kodu, üretim yılı ve araç özellikleriyle birlikte karşılaştır. Siparişten önce ürün sayfasındaki OEM numaralarını ve uyumlu araç listesini kontrol et. Daha fazlası için <Link href="/bilgi/uyumluluk">Doğru parçayı nasıl bulursun?</Link> sayfasına bak.</p>
  </>;
}

function OilFilter() {
  return <>
    <h2>Yağ filtresi ne işe yarar?</h2>
    <p>Yağ filtresi, motor yağının içinde dolaşan kir ve metal tozu gibi parçacıkları tutar. Yağ filtresi tıkandığında veya yağ kirlendiğinde motorun yağlanması bu durumdan etkilenebilir; bu yüzden filtre bakımın düzenli bir parçasıdır.</p>

    <h2>Yağ filtresi ne zaman değişir?</h2>
    <p>Yağ filtresi genellikle motor yağı değişimiyle birlikte değiştirilir. Değişim aralığı için araç üreticisinin bakım planı esas alınır; kilometre ve süre aralığı motora, kullanılan yağa ve kullanım koşullarına göre farklıdır. Aracının planını kullanım kılavuzunda veya yetkili serviste bulabilirsin.</p>
    <div className={tableWrap} tabIndex={0} role="region" aria-label="Tablo">
      <table>
        <thead><tr><th scope="col">Durum</th><th scope="col">Ne yapılır</th></tr></thead>
        <tbody>
          <tr><th scope="row">Motor yağı değişiyor</th><td>Yağ filtresi de genellikle birlikte değiştirilir</td></tr>
          <tr><th scope="row">Değişim zamanı belirsiz</th><td>Araç üreticisinin bakım planına bak</td></tr>
          <tr><th scope="row">Filtre türünden emin değilsin</th><td>OEM numarasını ve araç bilgilerini karşılaştır</td></tr>
        </tbody>
      </table>
    </div>

    <h2>Doğru yağ filtresini nasıl seçersin?</h2>
    <p>Filtreler aynı marka ve model altında bile motora göre farklı olabilir. Seçerken eski filtrenin üzerindeki numarayı veya OEM numarasını kullan, motor kodunu ve üretim yılını kontrol et. Ürün sayfasındaki OEM numaralarını ve uyumlu araç listesini siparişten önce incele. Ayrıntılar için <Link href="/rehber/oem-numarasi-nedir-nasil-bulunur">OEM numarası nedir, nasıl bulunur?</Link> yazısına bakabilirsin.</p>

    <h2>Yağ filtresiyle birlikte neler kontrol edilir?</h2>
    <ul>
      <li>Motor yağı: araç üreticisinin istediği özellikteki yağ seçilir; kullanım kılavuzu esastır.</li>
      <li>Diğer filtreler: hava ve polen filtresi de bakım planında yer alır.</li>
    </ul>
    <p>Filtre ve yağı birlikte bir set olarak seçmek istersen <Link href="/bakim-robotu">Bakım Robotu</Link> ile garajındaki araç için set kurabilirsin.</p>
  </>;
}

export const guideBodies: Record<string, () => React.JSX.Element> = {
  "oem-numarasi-nedir-nasil-bulunur": OemNumber,
  "yag-filtresi-ne-zaman-degisir": OilFilter,
};
