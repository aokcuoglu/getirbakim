// Search-result texts of the legal pages, apart from their reviewed copy in legal-pages.json (docs/legal-content.md).

// <title>s of pages whose footer label is too short for a search result (#1218); the label and breadcrumb stay short.
export const legalMetaTitles: Record<string, string> = {
  iletisim: "İletişim ve müşteri hizmetleri",
  "teslimat-ve-iade": "Teslimat ve iade koşulları",
  "cerez-politikasi": "Çerez politikası ve tercihler",
};

// Meta descriptions of 100–160 characters (#1218); the JSON's reviewed `description` stays the visible lead paragraph.
export const legalMetaDescriptions: Record<string, string> = {
  iletisim: "Getirbakim müşteri hizmetleri telefon ve e-posta bilgileri, şirket kimlik bilgileri, iade adresi ve başvuru kanalları.",
  "teslimat-ve-iade": "Teslimat süreleri ve kargo, cayma bildirimi, ürünün geri gönderilmesi, geri ödeme süreci ve ayıplı mal hakları.",
  "mesafeli-satis-sozlesmesi": "Getirbakim siparişlerinde tüketiciyle kurulan mesafeli satış sözleşmesinin genel hükümleri, cayma hakkı ve tarafların hakları.",
  "on-bilgilendirme-formu": "Getirbakim’de sipariş öncesinde sunulan ön bilgilendirme: satıcı bilgileri, ürün ve ödeme koşulları, teslimat ve tüketici hakları.",
  "uyelik-ve-kullanim-kosullari": "Getirbakim site kullanımı, üyelik ve servis hesapları, içerik hakları ve tarafların sorumluluklarına ilişkin koşullar.",
  "gizlilik-politikasi": "Getirbakim site hizmetlerinde kişisel verilerin nasıl kullanıldığı, nasıl korunduğu ve ilgili kişilerin başvuru hakları.",
  "cerez-politikasi": "Getirbakim’de kullanılan çerez ve yerel depolama kayıtları, kullanım amaçları, saklama süreleri ve tercihlerin yönetimi.",
};
