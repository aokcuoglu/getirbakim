// Second text of a top-level category (#646), shown under the product list with links to the related guides. It must
// differ from catalogDescription (the intro above the list and the meta description) and carries no interval or figure,
// so it never needs a source. Pure data so tests can read it.
import { isIndexableListing, type CatalogQuery } from "@/modules/store/catalog-query";
import { guidesForCategory, type Guide } from "./guides";

export type CategoryGuideNote = { heading: string; text: string };

export const categoryGuideNotes: Record<string, CategoryGuideNote> = {
  "yedek-parca": {
    heading: "Yedek parça seçerken nelere bakılır?",
    text: "Aynı model için motor koduna, üretim dönemine ve donanıma göre farklı parçalar üretilebilir; bu yüzden yalnızca model adına göre seçim yapmak yanıltıcı olur. Eski parçanın üzerindeki numara ile ürün sayfasındaki OEM listesini karşılaştırmak en güvenilir yoldur. Orijinal ve muadil parça arasındaki farkı ve OEM numarasını nereden bulacağını rehber yazılarımızda anlattık.",
  },
  fren: {
    heading: "Fren parçası seçerken nelere bakılır?",
    text: "Fren sistemi aynı modelde bile motor gücüne ve donanıma göre değişebilir; disk çapı ve balata ölçüsü bu yüzden araçtan araca farklı olur. Ön ve arka aks için ayrı parçalar kullanılır ve aşınma uyarısının sensörlü olup olmadığı da seçimi etkiler. Emin olmadığın durumda eski parçanın ölçüsünü ve numarasını esas al; montajı yetkin bir serviste yaptır.",
  },
  filtre: {
    heading: "Filtre seçerken nelere bakılır?",
    text: "Her filtrenin görevi ayrıdır: yağ filtresi motor yağını, hava filtresi motorun emdiği havayı, yakıt filtresi yakıtı, polen filtresi ise kabine giren havayı temizler. Dıştan birbirine benzeyen filtrelerin ölçüsü, conta yapısı veya bağlantısı farklı olabilir. Değişim zamanını araç üreticisinin bakım planı belirler; tozlu veya yoğun şehir içi kullanımda filtreleri daha sık kontrol ettir.",
  },
  yag: {
    heading: "Yağ ve bakım sıvısı seçerken nelere bakılır?",
    text: "Motor yağında belirleyici olan marka değil, aracının kullanım kılavuzunda istenen viskozite ve üretici onayıdır. Aynı kural antifriz, fren hidroliği ve şanzıman yağı için de geçerlidir: her biri kendi özelliğine göre seçilir ve farklı özellikteki sıvılar birbirine karıştırılmaz. Kılavuzdaki değerleri ürün sayfasındaki teknik bilgilerle karşılaştırarak ilerle.",
  },
  silecek: {
    heading: "Silecek seçerken nelere bakılır?",
    text: "Silecek süpürgesinde iki bilgi birlikte uymalıdır: uzunluk ve kol bağlantı tipi. Sürücü ve yolcu tarafı çoğu araçta farklı uzunluktadır; arka silecek ise ayrı bir parçadır. Süpürge camda iz bırakmaya, sekmeye veya ses yapmaya başladıysa lastiği yıpranmış demektir.",
  },
  aksesuar: {
    heading: "Aksesuar ve ekipman seçerken nelere bakılır?",
    text: "Aksesuar ve bakım ekipmanlarının bir kısmı her araçta kullanılabilir, bir kısmı ise belirli ölçü veya bağlantıya göre üretilir. Ürün sayfasındaki ölçü, bağlantı ve kullanım bilgilerini aracınla karşılaştırarak seç. Aradığın bilgiyi bulamazsan sipariş vermeden önce bize yaz.",
  },
};

/** The note and its guides for a plain first page of a top-level category; vehicle and manufacturer scopes get none. */
export function categoryGuideNote(query: CatalogQuery, scope: { vehicle?: boolean; manufacturer?: boolean } = {}): { note: CategoryGuideNote; guides: Guide[] } | undefined {
  const { category } = query;
  if (!category || !Object.hasOwn(categoryGuideNotes, category)) return undefined;
  if (query.make || query.model || query.manufacturer || scope.vehicle || scope.manufacturer || !isIndexableListing(query)) return undefined;
  return { note: categoryGuideNotes[category], guides: guidesForCategory(category) };
}
