// Curated intro copy of the catalog root and of some categories: the listing page shows it, listingMetadata fits it into
// the meta description. Entries from #1223 (top-level groups and the largest leaf categories) are 100–160 characters, so
// the meta description and the visible intro are the same text. Kept apart from catalog-view.tsx so metadata and tests
// can read it without the page's client imports.
const descriptions:Record<string,string>={
 "fren-diskleri-269":"Ön ve arka fren disklerini BOSCH, FEBI ve diğer üreticilerden seçeneklerle incele. Dolu veya havalandırmalı diskleri, ölçülerini ve montaj konumlarını karşılaştırarak aracına uygun parçayı bul. Bazı araçlarda sağ ve sol tarafta farklı diskler kullanılır; seçim yaparken OEM numarasını ve araç uyumluluğunu kontrol et. Aynı aks üzerindeki diskleri birlikte değiştir ve balataların durumunu da kontrol et.",
 "yedek-parca":"Aracının bakım ve onarımı için yedek parçaları tek yerde keşfet. Motor, fren, filtre ve diğer parça gruplarında ürünleri üreticiye göre incele; doğru parçayı bulmak için ürün kodu veya OEM numarasıyla ara. Sipariş vermeden önce parçanın araç modeli, motor tipi ve üretim yılıyla uyumluluğunu kontrol et.",
 fren:"Fren diskleri, balatalar ve fren sistemi parçalarını keşfet. Aracına uygun parçayı seçerken OEM kodunu, montaj konumunu ve araç özelliklerini kontrol et. Fren diskleri ve balataların aynı aks üzerindeki değişiminde üreticinin bakım önerilerini dikkate al.",
 filtre:"Yağ, hava, yakıt ve polen filtrelerini incele. Aracının motoruna ve modeline uygun filtreyi üretici veya ürün koduyla bul; bakım öncesinde OEM numarası ve araç bilgileriyle uyumluluğunu doğrula.",
 yag:"Motor yağları ve bakım sıvılarını incele. Aracın için doğru ürünü seçerken viskozite, üretici onayı ve kullanım kılavuzundaki özellikleri kontrol et.",
 silecek:"Silecek ve cam temizleme ürünlerini keşfet. Aracına uygun uzunluk ve bağlantı tipini kontrol ederek doğru ürünü seç.",
 aksesuar:"Araç bakımı için aksesuar ve ekipmanları incele. İhtiyacına uygun ürünleri marka ve ürün koduyla kolayca bul.",
 "motor-parcalari-4":"Triger seti, turbo, EGR valfi, motor takozu ve conta takımlarını incele. Parçayı motor koduna ve OEM numarasına göre seç, üreticileri karşılaştır.",
 "suspansiyon-663":"Amortisör, helezon yay, salıncak, rotil ve süspansiyon burçlarını incele. Parçayı ön/arka ve sağ/sol montaj konumuna göre seç, OEM numarasıyla doğrula.",
 "motor-sogutma-sistemi-296":"Radyatör, su pompası, termostat, hortum ve genleşme depolarını incele. Parçayı motor koduna ve OEM numarasına göre seç, antifriz seçeneklerine de göz at.",
 "elektrik-sistemi-323":"Alternatör, marş motoru, ateşleme bobini, buji ve kızdırma bujilerini incele. Parçayı motor tipine ve OEM koduna göre seç, üretici seçeneklerini karşılaştır.",
 "sanziman-ve-debriyaj-814":"Debriyaj seti, volan, aks mili, aks körüğü ve şanzıman takozlarını incele. Parçayı şanzıman tipine ve motor koduna göre seç, OEM numarasıyla doğrula.",
 "direksiyon-sistemi-676":"Rot başı, rot takımı, direksiyon kutusu, körük ve hidrolik direksiyon pompalarını incele. Parçayı sağ/sol konumuna ve OEM koduna göre seç.",
 "aydinlatma-895":"Far, stop lambası, sis farı, sinyal lambası ve ampulleri incele. Ampul tipini, soket yapısını ve montaj konumunu kontrol ederek aracına uygun ürünü seç.",
 "isitma-ve-havalandirma-414":"Klima kompresörü, kondenser, kalorifer radyatörü ve fan motorlarını incele. Parçayı aracının klima donanımına ve OEM numarasına göre seç.",
 "kaporta-ve-ic-donanim-443":"Ayna, tampon parçası, kapı kolu, kilit, cam krikosu ve bagaj amortisörlerini incele. Parçayı sağ/sol konumuna, kasa tipine ve OEM koduna göre seç.",
 "yakit-sistemi-740":"Yakıt pompası, enjektör, yüksek basınç pompası, yakıt hortumu ve AdBlue parçalarını incele. Parçayı motor koduna göre seç, OEM numarasıyla doğrula.",
 "egzoz-sistemi-198":"Lambda sensörü, egzoz sensörü, egzoz contası, valf ve bağlantı parçalarını incele. Parçayı motor koduna, emisyon normuna ve OEM numarasına göre seç.",
 "silecek-ve-cam-yikama-sistemi-606":"Silecek, silecek motoru, silecek mekanizması ve cam suyu pompalarını incele. Parçayı ön veya arka cama göre seç, OEM koduyla doğrula.",
 "fren-balatalari-268":"Ön ve arka fren balatalarını üreticilere göre incele. Balatayı aks konumuna, fren sistemi üreticisine ve ikaz kablosu olup olmadığına göre seç.",
 "salincaklar-713":"Ön ve arka salıncakları rotilli ve burçlu seçeneklerle incele. Salıncağı sağ/sol ve alt/üst konumuna göre seç, OEM numarasıyla kontrol et.",
 "hava-filtreleri-243":"Motor hava filtrelerini üreticilere göre incele. Filtrenin ölçüsünü ve biçimini karşılaştır, aracına uyup uymadığını OEM numarasıyla kontrol et.",
 "sensorler-366":"Hız, devir, basınç, sıcaklık, konum ve park sensörlerini incele. Sensörü montaj yerine, soket yapısına ve OEM koduna göre seç.",
 "rot-baslari-677":"Rot başlarını sağ ve sol tarafa göre incele. Parçayı OEM numarasına göre seç; değişimden sonra rot ayarı yaptırmayı unutma.",
 "motor-conta-ve-keceleri-10051":"Silindir kapak contası, supap kapağı contası, karter contası ve krank keçelerini incele. Contayı motor koduna ve OEM numarasına göre seç.",
 "motor-kayislari-ve-zincirleri-168":"Triger kayışı, triger zinciri, V ve kanallı kayışları incele. Kayışı motor koduna ve klima ya da hidrolik direksiyon donanımına göre seç, OEM koduyla doğrula.",
 "viraj-aski-rotlari-719":"Ön ve arka viraj askı rotlarını incele. Rotu sağ/sol konumuna ve süspansiyon tipine göre seç, aracına uyup uymadığını OEM koduyla kontrol et.",
 "suspansiyon-burclari-721":"Salıncak, aks ve viraj demiri burçlarını incele. Burcu montaj konumuna ve ölçüsüne göre seç, aracına uyup uymadığını OEM numarasıyla kontrol et.",
 "polen-filtreleri-246":"Standart ve aktif karbonlu polen filtrelerini incele. Kabin filtresini aracının modeline ve klima donanımına göre seç, OEM koduyla kontrol et.",
 "gergiler-kasnaklar-ve-sonumleyiciler-10036":"Triger gergi ve avare rulmanları, krank kasnakları ve titreşim sönümleyicilerini incele. Parçayı motor koduna ve kayış tipine göre seç.",
 "yakit-filtreleri-244":"Dizel ve benzinli motorlar için yakıt filtrelerini incele. Filtreyi motor koduna, bağlantı tipine ve su ayırıcısı olup olmadığına göre seç.",
 "su-pompalari-299":"Mekanik ve elektrikli su pompalarını incele. Pompayı motor koduna ve OEM numarasına göre seç; triger kayışıyla çalışan pompayı triger setiyle birlikte yenile.",
 "yag-filtreleri-242":"Kartuş ve kutu tipi yağ filtrelerini incele. Filtreyi motor koduna ve OEM numarasına göre seç; yağ değişiminde karter tapası pulunu da yenile.",
 "amortisorler-665":"Ön ve arka amortisörleri yağlı ve gazlı seçeneklerle incele. Amortisörü aks konumuna ve süspansiyon tipine göre seç; aynı akstaki çifti birlikte değiştir.",
 "motor-takozlari-135":"Hidrolik ve kauçuk motor takozlarını incele. Takozu sağ, sol, ön veya arka montaj konumuna, motor koduna ve OEM numarasına göre seç.",
 "debriyaj-setleri-824":"Baskı, disk ve rulmandan oluşan debriyaj setlerini incele. Seti motor koduna, şanzıman tipine ve volan yapısına göre seç, OEM numarasıyla kontrol et.",
 "motor-yaglari-957":"Motor yağlarını markaya göre incele. Yağı viskozite sınıfına ve araç üreticisinin onay normuna göre seç; aracının kullanım kılavuzundaki öneriyi esas al."
};

export const catalogDescription=(slug:string):string|undefined=>descriptions[slug];
export const curatedCategorySlugs=Object.keys(descriptions);
