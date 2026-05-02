import type { SupplierHealthStatus } from "@/types";
import type { SupplierAdapter, SupplierSearchResult, SupplierProductItem } from "./types";
import { logSupplierCall } from "./logger";

const MOCK_PRODUCTS: SupplierProductItem[] = [
  {
    id: "mock-001",
    name: "Fren Diski Ön",
    brand: "Brembo",
    category: "Fren Sistemi",
    description: "Ön aks fren diski, ventilasyonlu. Soğutma performansı artırılmış tasarım.",
    imageUrl: null,
    oemNumbers: ["09.A123.45", "09.A123.46"],
    offers: [
      {
        supplierId: "mock",
        supplierName: "Mock Tedarikçi",
        supplierSku: "MCK-FD-001",
        price: 850,
        currency: "TRY",
        stockQuantity: 12,
        deliveryDays: 1,
        isAvailable: true,
      },
    ],
  },
  {
    id: "mock-002",
    name: "Yağ Filtresi",
    brand: "Mann",
    category: "Filtreler",
    description: "Motor yağ filtresi. Tüm sentetik ve yarı sentetik yağlarla uyumlu.",
    imageUrl: null,
    oemNumbers: ["W914/2"],
    offers: [
      {
        supplierId: "mock",
        supplierName: "Mock Tedarikçi",
        supplierSku: "MCK-YF-002",
        price: 120,
        currency: "TRY",
        stockQuantity: 50,
        deliveryDays: 1,
        isAvailable: true,
      },
    ],
  },
  {
    id: "mock-003",
    name: "Amortisör Arka Sol",
    brand: "Sachs",
    category: "Süspansiyon",
    description: "Arka sol amortisör. Gaz basınçlı, orijinal ekipman kalitesinde.",
    imageUrl: null,
    oemNumbers: ["31356781234"],
    offers: [
      {
        supplierId: "mock",
        supplierName: "Mock Tedarikçi",
        supplierSku: "MCK-AM-003",
        price: 1450,
        currency: "TRY",
        stockQuantity: 4,
        deliveryDays: 2,
        isAvailable: true,
      },
    ],
  },
  {
    id: "mock-004",
    name: "Hava Filtresi",
    brand: "Knecht",
    category: "Filtreler",
    description: "Motor hava filtresi. Yüksek filtreleme kapasitesi.",
    imageUrl: null,
    oemNumbers: ["LX 1099"],
    offers: [
      {
        supplierId: "mock",
        supplierName: "Mock Tedarikçi",
        supplierSku: "MCK-HF-004",
        price: 180,
        currency: "TRY",
        stockQuantity: 30,
        deliveryDays: 1,
        isAvailable: true,
      },
    ],
  },
  {
    id: "mock-005",
    name: "V Kayışı",
    brand: "Continental",
    category: "Motor Parçaları",
    description: "Motor V kayışı. Dayanıklı kauçuk bileşim, uzun ömürlü.",
    imageUrl: null,
    oemNumbers: ["6PK1870"],
    offers: [
      {
        supplierId: "mock",
        supplierName: "Mock Tedarikçi",
        supplierSku: "MCK-VK-005",
        price: 250,
        currency: "TRY",
        stockQuantity: 20,
        deliveryDays: 1,
        isAvailable: true,
      },
    ],
  },
  {
    id: "mock-006",
    name: "Ön Balata Seti",
    brand: "TRW",
    category: "Fren Sistemi",
    description: "Ön fren balata seti. Seramik formül, düşük tozlu.",
    imageUrl: null,
    oemNumbers: ["GDB2078"],
    offers: [
      {
        supplierId: "mock",
        supplierName: "Mock Tedarikçi",
        supplierSku: "MCK-OB-006",
        price: 620,
        currency: "TRY",
        stockQuantity: 8,
        deliveryDays: 1,
        isAvailable: true,
      },
    ],
  },
  {
    id: "mock-007",
    name: "Radyatör",
    brand: "Valeo",
    category: "Soğutma Sistemi",
    description: "Alüminyum radyatör. Orijinal ekipman kalitesinde.",
    imageUrl: null,
    oemNumbers: ["732561"],
    offers: [
      {
        supplierId: "mock",
        supplierName: "Mock Tedarikçi",
        supplierSku: "MCK-RAD-007",
        price: 2200,
        currency: "TRY",
        stockQuantity: 2,
        deliveryDays: 3,
        isAvailable: true,
      },
    ],
  },
  {
    id: "mock-008",
    name: "Buji Seti (4'lü)",
    brand: "NGK",
    category: "Ateşleme Sistemi",
    description: "İridyum buji seti. 4 adet. Uzun ömürlü, yüksek performans.",
    imageUrl: null,
    oemNumbers: ["SILZKR7B-11S"],
    offers: [
      {
        supplierId: "mock",
        supplierName: "Mock Tedarikçi",
        supplierSku: "MCK-BJ-008",
        price: 480,
        currency: "TRY",
        stockQuantity: 15,
        deliveryDays: 1,
        isAvailable: true,
      },
    ],
  },
];

export class MockSupplierAdapter implements SupplierAdapter {
  readonly supplierId = "mock";
  readonly supplierName = "Mock Tedarikçi";
  readonly supplierSlug = "mock";
  readonly apiKey = "";
  readonly baseUrl = "";

  async search(query: string): Promise<SupplierSearchResult> {
    const q = query.toLowerCase();
    const matches = MOCK_PRODUCTS.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.brand && p.brand.toLowerCase().includes(q)) ||
        (p.category && p.category.toLowerCase().includes(q)) ||
        p.oemNumbers.some((oem) => oem.toLowerCase().includes(q))
    );

    await this.simulateLatency();

    void logSupplierCall({
      supplierId: this.supplierId,
      supplierName: this.supplierName,
      operation: "search",
      success: true,
      durationMs: Math.floor(50 + Math.random() * 150),
      statusCode: 200,
    });

    return {
      products: matches.map((p) => ({
        id: p.id,
        name: p.name,
        brand: p.brand,
        category: p.category,
        description: p.description,
        imageUrl: p.imageUrl,
        oemNumbers: p.oemNumbers,
        offers: p.offers,
      })),
    };
  }

  async getProduct(productId: string): Promise<SupplierProductItem | null> {
    await this.simulateLatency();
    return MOCK_PRODUCTS.find((p) => p.id === productId) ?? null;
  }

  async checkHealth(): Promise<SupplierHealthStatus> {
    return {
      supplierId: this.supplierId,
      supplierName: this.supplierName,
      isHealthy: true,
      lastChecked: new Date().toISOString(),
      responseTimeMs: 50,
      lastError: null,
    };
  }

  private simulateLatency(): Promise<void> {
    const ms = 50 + Math.random() * 150;
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}