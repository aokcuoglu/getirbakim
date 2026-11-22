// Curated intro copy of the catalog root and of some categories: the listing page shows it, listingMetadata fits it into
// the meta description. Kept apart from catalog-view.tsx so metadata and tests can read it without the page's client imports.
const descriptions:Record<string,string>={
 "fren-diskleri-269":"Ön ve arka fren disklerini BOSCH, FEBI ve diğer üreticilerden seçeneklerle incele. Dolu veya havalandırmalı diskleri, ölçülerini ve montaj konumlarını karşılaştırarak aracına uygun parçayı bul. Bazı araçlarda sağ ve sol tarafta farklı diskler kullanılır; seçim yaparken OEM numarasını ve araç uyumluluğunu kontrol et. Aynı aks üzerindeki diskleri birlikte değiştir ve balataların durumunu da kontrol et.",
 "yedek-parca":"Aracının bakım ve onarımı için yedek parçaları tek yerde keşfet. Motor, fren, filtre ve diğer parça gruplarında ürünleri üreticiye göre incele; doğru parçayı bulmak için ürün kodu veya OEM numarasıyla ara. Sipariş vermeden önce parçanın araç modeli, motor tipi ve üretim yılıyla uyumluluğunu kontrol et.",
 fren:"Fren diskleri, balatalar ve fren sistemi parçalarını keşfet. Aracına uygun parçayı seçerken OEM kodunu, montaj konumunu ve araç özelliklerini kontrol et. Fren diskleri ve balataların aynı aks üzerindeki değişiminde üreticinin bakım önerilerini dikkate al.",
 filtre:"Yağ, hava, yakıt ve polen filtrelerini incele. Aracının motoruna ve modeline uygun filtreyi üretici veya ürün koduyla bul; bakım öncesinde OEM numarası ve araç bilgileriyle uyumluluğunu doğrula.",
 yag:"Motor yağları ve bakım sıvılarını incele. Aracın için doğru ürünü seçerken viskozite, üretici onayı ve kullanım kılavuzundaki özellikleri kontrol et.",
 silecek:"Silecek ve cam temizleme ürünlerini keşfet. Aracına uygun uzunluk ve bağlantı tipini kontrol ederek doğru ürünü seç.",
 aksesuar:"Araç bakımı için aksesuar ve ekipmanları incele. İhtiyacına uygun ürünleri marka ve ürün koduyla kolayca bul."
};

export const catalogDescription=(slug:string):string|undefined=>descriptions[slug];
