/** Home first-screen copy (#1090). Plain data so tests can check the wording against the policy pages. */
export const homeHero = {
  title: "Yedek parçayı adıyla, markasıyla ya da OEM koduyla bul",
  lead: "Yedek parça ve bakım ürünlerinde fiyatı ve stok durumunu siparişten önce gör.",
};

export type HomeTrustIcon = "search" | "return" | "truck";

export const homeTrust: { icon: HomeTrustIcon; title: string; text: string; href: string }[] = [
  { icon: "search", title: "OEM numarasıyla arama", text: "Ürün kodu, marka veya OEM numarasıyla ara.", href: "/rehber/oem-numarasi-nedir-nasil-bulunur" },
  { icon: "return", title: "14 gün içinde cayma hakkı", text: "Teslim aldığın tarihten itibaren, gerekçe göstermeden.", href: "/teslimat-ve-iade" },
  { icon: "truck", title: "Kargo ücreti sepette gösterilir", text: "Ödemeden önce sepet ve sipariş özetinde görürsün.", href: "/bilgi/yardim#kargo-ve-teslimat" },
];

export const homeFeatured: { image: string; category: number; label: string; title: string; description: string }[] = [
  { image: "w40_brake_discs_web.jpg", category: 269, label: "FREN DİSKLERİ", title: "Her duruşta güven", description: "Fren disklerini ölçü ve montaj konumuna göre karşılaştır." },
  { image: "home-wiper-blades.webp", category: 607, label: "SİLECEKLER", title: "Her koşulda net görüş", description: "Silecekleri uzunluk ve bağlantı tipine göre incele." },
];
