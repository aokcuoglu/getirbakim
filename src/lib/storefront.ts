export const SITE_NAME = "getirbakim";
export const SITE_DOMAIN = "getirbakim.com";

export const NAV_CATEGORIES = [
  { label: "Tüm Kategoriler", href: "/search?q=" },
  { label: "Fren", href: "/search?q=fren" },
  { label: "Filtre", href: "/search?q=filtre" },
  { label: "Motor", href: "/search?q=motor" },
  { label: "Süspansiyon", href: "/search?q=süspansiyon" },
  { label: "Aydınlatma", href: "/search?q=aydınlatma" },
  { label: "Elektrik", href: "/search?q=eletrik" },
  { label: "Yağ & Bakım", href: "/search?q=yağ" },
  { label: "Kampanyalar", href: "/search?q=" },
];

export const CATEGORY_GRID = [
  { label: "Fren Sistemi", slug: "fren", href: "/search?q=fren", description: "Disk, balata, kaliper ve daha fazlası", icon: "disc" },
  { label: "Filtreler", slug: "filtre", href: "/search?q=filtre", description: "Yağ, hava, yakıt ve kabin filtreleri", icon: "filter" },
  { label: "Motor Parçaları", slug: "motor", href: "/search?q=motor", description: "Segman, piston, contalar ve motor aksamı", icon: "engine" },
  { label: "Aydınlatma", slug: "aydınlatma", href: "/search?q=aydınlatma", description: "Far, stop, sinyal ve LED arıza lambası", icon: "light" },
  { label: "Süspansiyon", slug: "süspansiyon", href: "/search?q=süspansiyon", description: "Amortisör, helezon, rotil ve rotbaşı", icon: "suspension" },
  { label: "Elektrik", slug: "elektrik", href: "/search?q=elektrik", description: "Aku, marş motoru, alternatör ve sensör", icon: "electric" },
  { label: "Soğutma", slug: "soğutma", href: "/search?q=soğutma", description: "Radyatör, fan, termostat ve su pompası", icon: "cooling" },
  { label: "Yağ & Bakım", slug: "yağ", href: "/search?q=yağ", description: "Motor yağı, bakım seti ve sıvılar", icon: "oil" },
  { label: "Kaporta", slug: "kaporta", href: "/search?q=kaporta", description: "Tampon, çamurluk, kapı ve kaporta aksamı", icon: "body" },
  { label: "İç Aksam", slug: "iç aksam", href: "/search?q=iç+aksam", description: "Koltuk, gösterge, direksiyon ve döşeme", icon: "interior" },
  { label: "Lastik & Jant", slug: "lastik", href: "/search?q=lastik", description: "Yazlık, kışlık lastik ve jant seçenekleri", icon: "tire" },
  { label: "Aktarma", slug: "aktarma", href: "/search?q=aktarma", description: "Debriyaj, şanzıman, aks ve diferansiyel", icon: "drivetrain" },
];

export const TRUST_BENEFITS = [
  {
    title: "390K+ Katalog Ürünü",
    description: "Dinamik, SETA ve ParcaTedarik katalogları",
    icon: "catalog",
  },
  {
    title: "OEM / SKU Arama",
    description: "Parça kodu ve OEM numarasıyla hızlı arama",
    icon: "search",
  },
  {
    title: "Stok & Fiyat Kontrolü",
    description: "Talep öncesi güncel doğrulama",
    icon: "stock",
  },
  {
    title: "Uyumluluk Teyidi",
    description: "Yanlış parça riskini azaltan kontrol akışı",
    icon: "shield",
  },
];

export const HERO_SEARCH_EXAMPLES = [
  { label: "Bosch", query: "Bosch" },
  { label: "filtre", query: "filtre" },
  { label: "balata", query: "balata" },
];

export const FEATURED_TABS = [
  { key: "all", label: "Tümü" },
  { key: "inStock", label: "Stokta Olanlar" },
  { key: "bosch", label: "Bosch" },
  { key: "filtre", label: "Filtre" },
  { key: "fren", label: "Fren" },
];