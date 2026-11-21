import Link from "next/link";

const tableWrap = "my-5 overflow-x-auto focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none";

function OemNumber() {
  return <>
    <h2>OEM numarası ne anlama gelir?</h2>
    <p>OEM, “Original Equipment Manufacturer” (orijinal ekipman üreticisi) ifadesinin kısaltmasıdır. Yedek parça dünyasında OEM numarası, bir parçayı araç veya parça üreticisinin kendi kataloğunda tanımlayan referans numarasıdır. Aynı numara üzerinden farklı üreticilerin ürettiği muadil parçalar da aranabilir.</p>
    <p>Bu yüzden OEM numarası, ürün adı ve marka bilgisinden daha kesin bir arama anahtarıdır. Ürün adları markadan markaya değişir, numara ise parçayı tarif eder.</p>

    <h2>OEM numarası ile ürün kodu aynı şey midir?</h2>
    <p>Hayır. Ürün kodu, parçayı üreten markanın kendi numarasıdır; OEM numarası ise aracı veya parçayı ilk üreten firmanın referansıdır. Bir ürünün birden fazla OEM numarası olabilir, bir OEM numarası da farklı markaların ürünlerine karşılık gelebilir.</p>
    <div className={tableWrap} tabIndex={0} role="region" aria-label="Numara türleri karşılaştırması">
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
    <div className={tableWrap} tabIndex={0} role="region" aria-label="Yağ filtresi değişim durumları">
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

function BrakePads() {
  return <>
    <h2>Fren balatası ne işe yarar?</h2>
    <p>Fren pedalına bastığında kaliper, balatayı fren diskine (bazı arka akslarda kampanaya) bastırır. Balata ile disk arasındaki sürtünme aracı yavaşlatır. Bu sürtünme balatayı ve diski zamanla aşındırır; balata bu yüzden düzenli değişen bir bakım parçasıdır.</p>

    <h2>Fren balatası ne zaman değişir?</h2>
    <p>Sabit bir kilometre yoktur. Aşınma; sürüş tarzına, trafiğe, araç ağırlığına ve balatanın yapısına göre değişir. Balata, sürtünme malzemesinin kalınlığı üreticinin belirlediği alt sınıra indiğinde değiştirilir. Kalınlık periyodik bakımda ölçülür.</p>
    <div className={tableWrap} tabIndex={0} role="region" aria-label="Fren balatası aşınma işaretleri">
      <table>
        <thead><tr><th scope="col">İşaret</th><th scope="col">Ne anlama gelebilir</th></tr></thead>
        <tbody>
          <tr><th scope="row">Gösterge panelinde balata uyarısı</th><td>Aşınma sensörü alt sınıra ulaşıldığını bildiriyor</td></tr>
          <tr><th scope="row">Frenlerken metalik sürtünme veya cızırtı sesi</th><td>Balatadaki aşınma uyarı sacı diske değiyor ya da balata bitmiş olabilir</td></tr>
          <tr><th scope="row">Fren mesafesinin uzaması, pedalın farklı hissettirmesi</th><td>Balata, disk veya fren hidroliği kontrol edilmeli</td></tr>
          <tr><th scope="row">Frenlerken direksiyonda titreme</th><td>Disk yüzeyi düzgünlüğünü kaybetmiş olabilir</td></tr>
        </tbody>
      </table>
    </div>
    <p>Bu işaretlerden biri varsa aracı bekletmeden bir servise kontrol ettir. Fren, güvenliği doğrudan etkileyen bir sistemdir.</p>

    <h2>Balata değişirken disk de değişmeli mi?</h2>
    <p>Her zaman değil. Diskin en az kalınlığı genellikle diskin kenarına basılıdır. Disk bu sınırın altındaysa, yüzeyi çizik ya da çarpılmışsa balatayla birlikte değiştirilir. Bazı üreticiler her balata değişiminde veya her iki balatada bir disk değişimini önerir; bakım planına bak. Balata ve disk her zaman aynı akstaki iki teker için birlikte değiştirilir; tek taraf değişirse fren dengesizleşir.</p>

    <h2>Doğru fren balatasını nasıl seçersin?</h2>
    <ul>
      <li><strong>Aks:</strong> Ön ve arka balatalar farklıdır. Çoğu araçta ön balatalar daha büyüktür ve daha hızlı aşınır.</li>
      <li><strong>Fren sistemi:</strong> Aynı modelde farklı kaliper markası veya disk çapı kullanılabilir. Bu yüzden motor ve donanım bilgisi önemlidir.</li>
      <li><strong>Aşınma sensörü:</strong> Aracında sensör varsa balatanın sensörlü ya da sensör bağlantılı olması gerekebilir. Bazı araçlarda sensör ayrı satılır ve balatayla birlikte yenilenir.</li>
      <li><strong>OEM numarası:</strong> Eski balatanın üzerindeki numarayı veya OEM numarasını ürün sayfasındakilerle karşılaştır.</li>
    </ul>
    <p>Ürün sayfasında uyumlu araç listesini ve OEM numaralarını siparişten önce kontrol et. Aracını <Link href="/garaj">Garajım</Link> alanına eklersen katalog sana uyan ürünleri gösterir.</p>
  </>;
}

function AirAndCabinFilter() {
  return <>
    <h2>Hava filtresi ne işe yarar?</h2>
    <p>Motor hava filtresi, motorun yanma için emdiği havadaki toz ve kiri tutar. Temiz hava; motor parçalarını aşınmaya karşı korur ve yanmanın düzgün olmasına yardım eder. Hava filtresi genellikle motor bölmesinde, hava giriş hattı üzerindeki plastik bir kutunun içindedir.</p>

    <h2>Polen filtresi ne işe yarar?</h2>
    <p>Polen filtresi (kabin filtresi), havalandırma ve klima sisteminden kabine giren havayı temizler. Toz ve poleni tutar; aktif karbonlu türleri kokuları ve bazı gazları da azaltır. Polen filtresi çoğu araçta torpido gözünün arkasında veya ön camın altındaki bölmededir.</p>
    <div className={tableWrap} tabIndex={0} role="region" aria-label="Hava filtresi ve polen filtresi karşılaştırması">
      <table>
        <thead><tr><th scope="col">Özellik</th><th scope="col">Hava filtresi</th><th scope="col">Polen filtresi</th></tr></thead>
        <tbody>
          <tr><th scope="row">Neyi temizler</th><td>Motora giren havayı</td><td>Kabine giren havayı</td></tr>
          <tr><th scope="row">Nerede durur</th><td>Motor bölmesindeki hava filtresi kutusunda</td><td>Çoğunlukla torpido arkasında veya ön cam altında</td></tr>
          <tr><th scope="row">Tıkandığında</th><td>Motor yeterince hava alamaz</td><td>Havalandırma zayıflar, camlar daha geç açılır, koku olabilir</td></tr>
          <tr><th scope="row">Türleri</th><td>Kağıt panel, yuvarlak (silindirik)</td><td>Standart, aktif karbonlu</td></tr>
        </tbody>
      </table>
    </div>

    <h2>Hava ve polen filtresi ne zaman değişir?</h2>
    <p>İki filtrenin değişim aralığı araç üreticisinin bakım planında ayrı ayrı yazar. Toprak yol, inşaat bölgesi veya yoğun şehir trafiği gibi tozlu koşullarda filtreler daha çabuk dolar; bu koşullarda daha sık kontrol edilir. Polen filtresi çoğu zaman yılda bir, bahar ya da yaz öncesinde değiştirilir.</p>

    <h2>Doğru filtreyi nasıl seçersin?</h2>
    <p>Filtreler ölçü ve şekil olarak araca özeldir. Aynı model içinde bile motora göre hava filtresi değişebilir. Eski filtrenin üzerindeki numarayı veya OEM numarasını kullan, motor kodunu ve üretim yılını kontrol et. Yağ, hava ve polen filtresini birlikte seçmek istersen <Link href="/bakim-robotu">Bakım Robotu</Link> ile aracına uygun bir bakım seti kurabilirsin.</p>
  </>;
}

function EngineOil() {
  return <>
    <h2>Motor yağı seçerken neye bakılır?</h2>
    <p>Kutunun üzerinde üç bilgi önemlidir: <strong>viskozite</strong> (ör. 5W-30), <strong>kalite sınıfı</strong> (ACEA ve/veya API) ve <strong>araç üreticisi onayı</strong> (ör. VW 504 00, MB 229.51, BMW Longlife-04). Aracının hangi değerleri istediği kullanım kılavuzunda yazar. Kılavuzdaki değerlerle kutudaki değerler eşleşmelidir.</p>

    <h2>5W-30 ne anlama gelir?</h2>
    <p>Bu değer SAE J300 viskozite sınıflandırmasıdır. “W” öncesindeki sayı (5W) yağın soğukta ne kadar kolay aktığını gösterir; sayı küçüldükçe soğuk çalıştırmada yağ motora daha hızlı ulaşır. Tireden sonraki sayı (30) yağın motor çalışma sıcaklığındaki kıvamını gösterir. Kılavuzda birden fazla viskozite yazıyorsa genellikle iklime göre bir tablo verilir.</p>
    <div className={tableWrap} tabIndex={0} role="region" aria-label="Motor yağı etiketindeki bilgiler">
      <table>
        <thead><tr><th scope="col">Bilgi</th><th scope="col">Örnek</th><th scope="col">Neyi gösterir</th></tr></thead>
        <tbody>
          <tr><th scope="row">Viskozite</th><td>5W-30, 0W-20, 10W-40</td><td>Soğukta ve çalışma sıcaklığında akışkanlık</td></tr>
          <tr><th scope="row">ACEA sınıfı</th><td>C3, A3/B4</td><td>Avrupa motorları için genel kalite ve kimya seviyesi (C sınıfları partikül filtreli motorlar için düşük kül)</td></tr>
          <tr><th scope="row">API sınıfı</th><td>SP, SN</td><td>Amerikan sınıflandırmasındaki kalite seviyesi</td></tr>
          <tr><th scope="row">Üretici onayı</th><td>VW 504 00, MB 229.51</td><td>Yağın o üreticinin testlerinden geçtiği</td></tr>
        </tbody>
      </table>
    </div>

    <h2>Hangisi daha önemli: viskozite mi, onay mı?</h2>
    <p>Kılavuzda bir üretici onayı veya özellik yazıyorsa ilk bakılacak bilgi odur. Özellikle dizel partikül filtreli (DPF) motorlarda ve uzun bakım aralıklı (longlife) araçlarda, yanlış kül seviyesindeki yağ filtre ve motor ömrünü etkileyebilir. Onayı karşılayan yağlar arasından kılavuzdaki viskozite seçilir. Yalnızca viskozite aynı diye onaysız bir yağ seçmek doğru değildir.</p>

    <h2>Ne kadar yağ gerekir, filtre de değişmeli mi?</h2>
    <p>Motorun yağ kapasitesi (filtreyle birlikte) kullanım kılavuzunda yazar. Yağ değişiminde yağ filtresi de genellikle birlikte değiştirilir; ayrıntılar için <Link href="/rehber/yag-filtresi-ne-zaman-degisir">Yağ filtresi ne zaman değişir?</Link> yazısına bak. Yağ ve filtreyi birlikte seçmek için <Link href="/bakim-robotu">Bakım Robotu</Link>’nu kullanabilirsin.</p>
  </>;
}

function Battery() {
  return <>
    <h2>Akünün zayıfladığı nasıl anlaşılır?</h2>
    <ul>
      <li>Marş motoru her zamankinden yavaş dönüyor, özellikle soğuk sabahlarda araç zor çalışıyor.</li>
      <li>Araç birkaç gün beklediğinde çalışmıyor veya takviye gerekiyor.</li>
      <li>Gösterge panelinde akü veya şarj uyarısı yanıyor.</li>
      <li>Start-stop sistemi devreye girmiyor (birçok araç akü zayıfken bu sistemi kapatır).</li>
    </ul>
    <p>Bu işaretler her zaman akü kaynaklı değildir; şarj dinamosu veya bir tüketicinin aküyü boşaltması da aynı belirtileri verebilir. Akü test cihazıyla yapılan ölçüm kesin sonucu verir.</p>

    <h2>Akü ne zaman değişir?</h2>
    <p>Akünün ömrü; iklime, kısa yol kullanımına, aracın elektrik tüketimine ve akünün teknolojisine göre değişir. Sabit bir yıl yerine, test sonucunda kapasitenin düştüğü görüldüğünde veya yukarıdaki belirtiler tekrarladığında değiştirilir. Aşırı sıcak ve sık kısa yol aküyü daha çabuk yıpratır.</p>

    <h2>Hangi akü uyar?</h2>
    <div className={tableWrap} tabIndex={0} role="region" aria-label="Akü seçerken bakılacak değerler">
      <table>
        <thead><tr><th scope="col">Değer</th><th scope="col">Örnek</th><th scope="col">Neden önemli</th></tr></thead>
        <tbody>
          <tr><th scope="row">Kapasite</th><td>60 Ah, 72 Ah</td><td>Akünün depoladığı enerji; eskisiyle aynı veya üreticinin izin verdiği aralıkta olmalı</td></tr>
          <tr><th scope="row">Soğuk marş akımı</th><td>540 A (EN)</td><td>Soğukta marş gücü; en az eskisi kadar olmalı</td></tr>
          <tr><th scope="row">Kutu ölçüsü</th><td>Uzunluk × genişlik × yükseklik</td><td>Akü yuvasına ve bağlantı parçasına oturmalı</td></tr>
          <tr><th scope="row">Kutup yönü</th><td>Sağ artı / sol artı</td><td>Kablolar ters kutba uzanmaz; yön eskisiyle aynı olmalı</td></tr>
          <tr><th scope="row">Teknoloji</th><td>Standart, EFB, AGM</td><td>Start-stop sistemli araçlar EFB veya AGM ister</td></tr>
        </tbody>
      </table>
    </div>
    <p>Start-stop sistemli bir araçta standart akü kullanmak akünün kısa sürede bozulmasına yol açar. AGM akü takılı bir araçta yerine yine AGM takılır. Bazı araçlarda yeni akünün aracın bilgisayarına tanıtılması (kodlanması) gerekir; bu, akü yönetim sisteminin doğru şarj etmesi için yapılır.</p>

    <h2>Akü değiştirirken nelere dikkat edilir?</h2>
    <p>Sökerken önce eksi (−), takarken önce artı (+) kutup bağlanır. Eski akü tehlikeli atıktır; akü satan noktalara veya geri dönüşüm noktalarına teslim edilir. Değerlerden emin değilsen eski akünün etiketinin fotoğrafını ve araç bilgilerini bize ilet; birlikte bakalım.</p>
  </>;
}

function TimingBelt() {
  return <>
    <h2>Triger kayışı ne işe yarar?</h2>
    <p>Triger kayışı, krank milinin dönüşünü eksantrik mile aktarır ve supapların pistonlarla doğru zamanda açılıp kapanmasını sağlar. Kayış kayar veya koparsa motor durur; birçok motorda (“girişimli” motorlar) pistonlar supaplara çarpar ve ciddi, pahalı bir motor hasarı oluşur.</p>

    <h2>Triger kayışı ne zaman değişir?</h2>
    <p>Araç üreticisinin bakım planında hem bir kilometre hem bir süre sınırı yazar; hangisi önce dolarsa kayış o zaman değiştirilir. Az kullanılan bir araçta kilometre dolmasa bile kayış zamanla yaşlanır. Aralık motordan motora çok farklıdır; başka bir aracın değeri örnek alınmaz. Aracın bakım geçmişi belli değilse (ör. ikinci el alımında) triger değişiminin yapılıp yapılmadığı belgelerden kontrol edilir.</p>
    <p>Kayışta çatlak, diş kopması, yağ veya antifriz bulaşması ya da motor bölmesinden gelen düzensiz bir ses varsa aralık beklenmeden kontrol ettirilir.</p>

    <h2>Triger setinde neler bulunur?</h2>
    <div className={tableWrap} tabIndex={0} role="region" aria-label="Triger seti içeriği">
      <table>
        <thead><tr><th scope="col">Parça</th><th scope="col">Görevi</th></tr></thead>
        <tbody>
          <tr><th scope="row">Triger kayışı</th><td>Krank ve eksantrik milini senkron döndürür</td></tr>
          <tr><th scope="row">Gergi rulmanı</th><td>Kayışı doğru gerginlikte tutar</td></tr>
          <tr><th scope="row">Avara rulmanı</th><td>Kayışı yönlendirir</td></tr>
          <tr><th scope="row">Devirdaim pompası (bazı setlerde)</th><td>Soğutma sıvısını dolaştırır; kayışla döndüğü motorlarda birlikte değiştirilmesi önerilir</td></tr>
        </tbody>
      </table>
    </div>
    <p>Yalnızca kayışı değiştirip eski rulmanları bırakmak önerilmez; rulmanın dağılması da kayışı koparabilir. Bu yüzden parçalar set olarak satılır. Montaj, motor zamanlamasının doğru ayarlanmasını gerektirir ve özel aparatlarla bir serviste yapılmalıdır.</p>

    <h2>Triger zincirli motorlarda durum ne?</h2>
    <p>Bazı motorlarda kayış yerine triger zinciri kullanılır. Zincir genellikle periyodik değişim gerektirmez, ama uzayabilir veya gergisi yıpranabilir. Soğuk çalıştırmada motorun önünden gelen şıkırtı sesi bunun işareti olabilir. Aracında kayış mı zincir mi olduğu bakım planında veya kullanım kılavuzunda yazar.</p>

    <h2>Doğru triger setini nasıl seçersin?</h2>
    <p>Triger seti motora özeldir. Motor kodunu, üretim yılını ve OEM numarasını karşılaştır; ürün sayfasındaki uyumlu araç listesini siparişten önce kontrol et. Ayrıntılar için <Link href="/rehber/oem-numarasi-nedir-nasil-bulunur">OEM numarası nedir, nasıl bulunur?</Link> yazısına bak.</p>
  </>;
}

function WiperSize() {
  return <>
    <h2>Silecek ölçüsü nasıl bulunur?</h2>
    <ul>
      <li><strong>Eski süpürgeyi ölç:</strong> Süpürgenin lastik kısmını bir uçtan diğerine ölç. Ölçüler genellikle milimetre (ör. 600 mm) veya inç (ör. 24 inç) olarak verilir; 1 inç 25,4 mm’dir.</li>
      <li><strong>Etikete bak:</strong> Bazı süpürgelerin üzerinde uzunluk veya ürün kodu yazar.</li>
      <li><strong>Araç modeline göre ara:</strong> Silecek üreticileri araç modeli ve üretim yılına göre uygulama listesi yayımlar. Aracını <Link href="/garaj">Garajım</Link> alanına eklersen katalog uyan sileceklerini gösterir.</li>
    </ul>

    <h2>Sürücü ve yolcu tarafı aynı mı?</h2>
    <p>Çoğu araçta değildir. Sürücü tarafı süpürgesi genellikle daha uzundur. Bazı araçlarda tek büyük silecek veya iki tarafı aynı süpürge bulunur. Arka cam sileceği ayrıca ve farklı ölçüde olur. Set alırken her iki tarafın ölçüsünü kontrol et.</p>

    <h2>Bağlantı tipi neden önemli?</h2>
    <p>Süpürge, silecek koluna bir bağlantı parçasıyla takılır. Uzunluk doğru olsa bile bağlantı tipi uymazsa süpürge takılmaz ya da güvenli oturmaz.</p>
    <div className={tableWrap} tabIndex={0} role="region" aria-label="Silecek bağlantı tipleri">
      <table>
        <thead><tr><th scope="col">Bağlantı tipi</th><th scope="col">Nasıl görünür</th></tr></thead>
        <tbody>
          <tr><th scope="row">Kanca (U tipi)</th><td>Kolun ucu U harfi gibi kıvrıktır; en yaygın tiptir</td></tr>
          <tr><th scope="row">Pim (yan pim)</th><td>Kolun yanında süpürgeye giren bir pim vardır</td></tr>
          <tr><th scope="row">Basmalı düğme</th><td>Kol ucunda basılarak açılan düz bir bağlantı vardır</td></tr>
          <tr><th scope="row">Üstten kilit (top lock)</th><td>Kol ucu düzdür, süpürge üstten geçip kilitlenir</td></tr>
        </tbody>
      </table>
    </div>
    <p>Birçok süpürge farklı tipler için adaptörle gelir. Ürün sayfasında hangi bağlantıları desteklediğini kontrol et.</p>

    <h2>Silecek süpürgesi ne zaman değişir?</h2>
    <p>Süpürge camda iz veya çizgi bırakıyorsa, camda sekiyorsa, gıcırdıyorsa ya da lastikte çatlak ve sertleşme varsa değiştirilir. Güneş ve sıcak lastiği yaşlandırır; birçok sürücü süpürgeleri yılda bir, kış öncesinde yeniler. Silecekleri kuru camda çalıştırmamak ve camı temiz tutmak lastik ömrünü uzatır.</p>
  </>;
}

function Coolant() {
  return <>
    <h2>Antifriz ne işe yarar?</h2>
    <p>Antifriz, su ile karıştırılarak soğutma sıvısını oluşturur. Kışın donmayı önler, yazın kaynama noktasını yükseltir ve en önemlisi soğutma sistemindeki metal ve conta parçalarını korozyona karşı korur. Koruma katkıları zamanla tükendiği için soğutma sıvısı da bakım planına göre yenilenir.</p>

    <h2>Antifriz rengi neden yeterli değil?</h2>
    <p>Antifrizin rengi bir standart değildir; üreticiler boyayı kendileri seçer. Aynı kimyadaki iki ürün farklı renkte, farklı kimyadaki iki ürün aynı renkte olabilir. Örneğin pembe veya mor bir antifriz farklı markalarda farklı teknolojiye karşılık gelebilir. Bu yüzden seçim renge göre değil, araç üreticisinin istediği özellik veya onaya göre yapılır.</p>
    <div className={tableWrap} tabIndex={0} role="region" aria-label="Antifriz teknolojileri">
      <table>
        <thead><tr><th scope="col">Teknoloji</th><th scope="col">Kısaca</th></tr></thead>
        <tbody>
          <tr><th scope="row">IAT (inorganik)</th><td>Silikat ve fosfat bazlı, eski tip; koruması daha kısa sürer</td></tr>
          <tr><th scope="row">OAT (organik asit)</th><td>Uzun ömürlü; birçok modern araçta kullanılır</td></tr>
          <tr><th scope="row">HOAT / Si-OAT (hibrit)</th><td>Organik asit ile az miktarda silikat; birçok Avrupa üreticisinin güncel özellikleri bu gruptadır</td></tr>
        </tbody>
      </table>
    </div>

    <h2>Hangi antifriz uyar?</h2>
    <p>Kullanım kılavuzunda soğutma sıvısı için bir özellik veya onay yazar; örneğin VW TL 774 (G12evo, G13), MB 325.x veya üreticinin kendi kodu. Antifriz kutusunda bu onayın yazdığını kontrol et. Hazır karışım (kullanıma hazır) ve konsantre ürünler vardır; konsantre ürün, kutudaki orana göre (çoğu zaman yarı yarıya) saf veya arı su ile karıştırılır.</p>

    <h2>Farklı antifrizler karıştırılabilir mi?</h2>
    <p>Emin değilsen karıştırma. Uyumsuz kimyalar birbirinin koruma katkılarını zayıflatabilir veya çökelti oluşturabilir. Seviye eksikse sistemdeki sıvıyla aynı özellikte bir ürün ekle. Antifriz türü değişecekse sistem boşaltılıp yıkanır ve yeni sıvıyla doldurulur. Sık seviye eksilmesi bir kaçağın işaretidir ve kontrol ettirilmelidir.</p>
    <p>Motor sıcakken radyatör veya genleşme kabının kapağını açma; basınçlı sıcak sıvı yaralanmaya yol açabilir.</p>
  </>;
}

function AftermarketVsOriginal() {
  return <>
    <h2>Orijinal, OES ve muadil parça ne demek?</h2>
    <div className={tableWrap} tabIndex={0} role="region" aria-label="Parça türleri karşılaştırması">
      <table>
        <thead><tr><th scope="col">Tür</th><th scope="col">Kim üretir, nasıl satılır</th></tr></thead>
        <tbody>
          <tr><th scope="row">Orijinal (OE)</th><td>Araç üreticisi için üretilir, araç markasının logosu ve kutusuyla satılır</td></tr>
          <tr><th scope="row">OES (orijinal ekipman tedarikçisi)</th><td>Araç üreticisine parça veren firmanın aynı parçayı kendi markasıyla sattığı üründür</td></tr>
          <tr><th scope="row">Muadil (yan sanayi)</th><td>Başka bir üreticinin aynı ölçü ve işlevle ürettiği parçadır; kalite markadan markaya değişir</td></tr>
        </tbody>
      </table>
    </div>
    <p>Bir araç markası birçok parçayı kendisi üretmez; tedarikçilerden alır. Bu yüzden orijinal kutudaki bir parça ile tanınmış bir tedarikçinin kendi kutusundaki parça çoğu zaman aynı üretim hattından çıkar.</p>

    <h2>Muadil parça güvenli mi?</h2>
    <p>Bilinen bir üreticinin, doğru OEM numarasına karşılık gelen muadil parçası güvenli bir seçenektir ve çoğu zaman daha uygun fiyatlıdır. Kalite ise markaya bağlıdır; bu yüzden markası belirsiz, numarası eşleşmeyen veya ölçüsü tutmayan parçalardan kaçınılır. Fren, direksiyon ve süspansiyon gibi güvenlik parçalarında tanınmış markaları tercih et.</p>

    <h2>Muadil parça garantiyi bozar mı?</h2>
    <p>Türkiye’de Rekabet Kurumu’nun 2017/3 sayılı Grup Muafiyeti Tebliği, yetkili servis dışındaki bakım ve eşdeğer kalitedeki parça kullanımının önünün kesilmemesini amaçlar. Yine de garanti kapsamı ve koşulları aracın garanti belgesinde yazar; garantili bir araçta bakım yaptırmadan önce kendi belgeni kontrol et ve yapılan işlerin faturasını sakla.</p>

    <h2>Hangisini ne zaman seçebilirsin?</h2>
    <ul>
      <li><strong>Orijinal:</strong> Muadili bulunmayan, araca özel elektronik veya gövde parçalarında ya da garanti belgesi özellikle istiyorsa.</li>
      <li><strong>OES:</strong> Orijinal kalitede ama daha uygun fiyatlı bir parça istiyorsan.</li>
      <li><strong>Muadil:</strong> Filtre, balata, silecek gibi düzenli değişen bakım parçalarında, tanınmış bir markanın numarası eşleşen ürününü seçiyorsan.</li>
    </ul>
    <p>Hangi türü seçersen seç, ürün sayfasındaki OEM numaralarını ve uyumlu araç listesini karşılaştır. Ayrıntılar için <Link href="/rehber/oem-numarasi-nedir-nasil-bulunur">OEM numarası nedir, nasıl bulunur?</Link> ve <Link href="/bilgi/uyumluluk">Doğru parçayı nasıl bulursun?</Link> sayfalarına bak.</p>
  </>;
}

export const guideBodies: Record<string, () => React.JSX.Element> = {
  "oem-numarasi-nedir-nasil-bulunur": OemNumber,
  "yag-filtresi-ne-zaman-degisir": OilFilter,
  "fren-balatasi-ne-zaman-degisir-nasil-secilir": BrakePads,
  "hava-filtresi-ve-polen-filtresi-farki": AirAndCabinFilter,
  "motor-yagi-nasil-secilir": EngineOil,
  "aku-ne-zaman-degisir-hangi-aku-uyar": Battery,
  "triger-seti-ne-zaman-degisir": TimingBelt,
  "silecek-supurgesi-olcusu-nasil-bulunur": WiperSize,
  "antifriz-rengi-onemli-mi": Coolant,
  "muadil-parca-mi-orijinal-parca-mi": AftermarketVsOriginal,
};
