import Link from "next/link";
import type { NormalizedProduct } from "@/types";
import { formatPrice } from "@/lib/utils";
import { ArrowRight, Package, Database, AlertTriangle } from "lucide-react";

interface ProductCardProps {
  product: NormalizedProduct & { dataSource?: string };
}

const SUPPLIER_DISPLAY_NAMES: Record<string, string> = {
  dinamik: "Dinamik",
  "dinamik oto": "Dinamik",
  parcatedarik: "Parçatedarik",
  seta: "Seta",
  basbug: "Başbuğ",
  mock: "Mock Tedarikçi",
};

function getSupplierDisplayName(supplierName: string): string {
  const key = supplierName.toLowerCase().trim();
  for (const [k, v] of Object.entries(SUPPLIER_DISPLAY_NAMES)) {
    if (key.includes(k)) return v;
  }
  return supplierName;
}

export function ProductCard({ product }: ProductCardProps) {
  const bestOffer = product.offers.reduce(
    (best, offer) => (offer.price < best.price ? offer : best),
    product.offers[0]
  );
  const availableOffers = product.offers.filter((o) => o.isAvailable);
  const totalStock = product.offers.reduce(
    (sum, offer) => sum + offer.stockQuantity,
    0
  );

  const isFromDb = product.dataSource === "existing-db";

  return (
    <div className="border border-gray-200 rounded-md bg-white hover:border-gray-400 transition-all group">
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-base text-black group-hover:underline truncate">
              {product.name}
            </h3>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {product.brand && (
                <span className="text-sm text-gray-600">{product.brand}</span>
              )}
              {product.category && (
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                  {product.category}
                </span>
              )}
            </div>
          </div>
          {bestOffer && (
            <div className="text-right shrink-0">
              <p className="font-bold text-lg text-black">
                {formatPrice(bestOffer.price, bestOffer.currency)}
              </p>
              <p className="text-xs text-gray-500">en düşük fiyat</p>
            </div>
          )}
        </div>

        {product.oem_numbers.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {product.oem_numbers.slice(0, 3).map((oem) => (
              <span
                key={oem}
                className="text-xs font-mono bg-gray-50 border border-gray-200 text-gray-600 px-1.5 py-0.5 rounded"
              >
                {oem}
              </span>
            ))}
            {product.oem_numbers.length > 3 && (
              <span className="text-xs text-gray-400">
                +{product.oem_numbers.length - 3}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center gap-4 text-xs text-gray-500 mb-4">
          <span className="flex items-center gap-1">
            <Package className="h-3.5 w-3.5" />
            {product.offers.length} tedarikçi
          </span>
          {totalStock > 0 ? (
            <span className="flex items-center gap-1 text-green-700">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              {availableOffers.length > 0
                ? `${availableOffers.length} tedarikçide stokta`
                : `${totalStock} adet`}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-red-600">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              Stokta yok
            </span>
          )}
        </div>

        {isFromDb && (
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center gap-1 text-xs font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-200">
              <Database className="h-3 w-3" />
              Katalog verisi
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 mb-3 text-xs text-gray-500">
          {product.offers.map((offer) => (
            <span
              key={offer.supplierId}
              className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded"
            >
              {getSupplierDisplayName(offer.supplierName)}
            </span>
          ))}
        </div>

        {isFromDb && (
          <div className="flex items-center gap-1.5 text-xs text-amber-600 mb-3">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>
              Fiyat ve stok bilgisi talep öncesinde tekrar doğrulanır.
            </span>
          </div>
        )}

        <div className="flex items-center gap-3 border-t border-gray-100 pt-3">
          <Link
            href={`/products/${product.id}`}
            className="flex-1 inline-flex items-center justify-center bg-black text-white text-sm font-medium py-2.5 rounded hover:bg-gray-800 transition-colors"
          >
            Detayı Gör
            <ArrowRight className="h-4 w-4 ml-1.5" />
          </Link>
          <Link
            href={`/request?productId=${encodeURIComponent(product.id)}`}
            className="flex-1 inline-flex items-center justify-center border border-gray-300 text-black text-sm font-medium py-2.5 rounded hover:bg-gray-50 transition-colors"
          >
            Uyumluluğu Kontrol Et
          </Link>
        </div>
      </div>
    </div>
  );
}