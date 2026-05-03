import Link from "next/link";
import type { NormalizedProduct } from "@/types";
import { formatPrice } from "@/lib/utils";
import { Package, Database, AlertTriangle, Tag, ShieldCheck } from "lucide-react";

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
    product.offers[0],
  );
  const totalStock = product.offers.reduce(
    (sum, offer) => sum + offer.stockQuantity,
    0,
  );
  const isFromDb = product.dataSource === "existing-db";

  return (
    <div className="border border-border rounded-lg bg-white hover:shadow-md hover:border-slate-300 transition-all group flex flex-col">
      {/* Image area */}
      <div className="relative bg-surface-alt rounded-t-lg h-40 flex items-center justify-center overflow-hidden">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            className="w-full h-full object-contain p-4 group-hover:scale-105 transition-transform"
            loading="lazy"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted">
            <Package className="h-10 w-10 opacity-30" />
            <span className="text-xs opacity-50">Ürün görseli</span>
          </div>
        )}
        {isFromDb && (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 text-[10px] font-semibold bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-200">
            <Database className="h-3 w-3" />
            Katalog verisi
          </span>
        )}
        {totalStock > 0 ? (
          <span className="absolute top-2 right-2 inline-flex items-center gap-1 text-[10px] font-semibold bg-green-50 text-green-700 px-2 py-0.5 rounded border border-green-200">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            Stokta
          </span>
        ) : (
          <span className="absolute top-2 right-2 inline-flex items-center gap-1 text-[10px] font-semibold bg-red-50 text-red-600 px-2 py-0.5 rounded border border-red-200">
            Stokta yok
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 p-4">
        {/* Supplier Badge */}
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          {product.offers.map((offer) => (
            <span
              key={offer.supplierId}
              className="text-[10px] font-semibold bg-primary/5 text-primary px-2 py-0.5 rounded border border-primary/10"
            >
              {getSupplierDisplayName(offer.supplierName)}
            </span>
          ))}
          {product.brand && (
            <span className="text-[10px] font-medium bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
              {product.brand}
            </span>
          )}
        </div>

        {/* Product Name */}
        <h3 className="font-semibold text-sm text-foreground leading-snug mb-2 line-clamp-2 group-hover:text-accent transition-colors">
          {product.name}
        </h3>

        {/* SKU */}
        {bestOffer?.supplierSku && (
          <div className="flex items-center gap-1.5 mb-2">
            <Tag className="h-3 w-3 text-muted" />
            <code className="text-xs font-mono text-muted bg-surface px-1.5 py-0.5 rounded">
              {bestOffer.supplierSku}
            </code>
          </div>
        )}

        {/* OEM Chips */}
        {product.oem_numbers.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {product.oem_numbers.slice(0, 3).map((oem) => (
              <span
                key={oem}
                className="text-[10px] font-mono bg-surface border border-border text-muted px-1.5 py-0.5 rounded"
              >
                {oem}
              </span>
            ))}
            {product.oem_numbers.length > 3 && (
              <span className="text-[10px] text-muted">
                +{product.oem_numbers.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Price */}
        <div className="mt-auto pt-3 border-t border-border">
          {bestOffer && bestOffer.price > 0 ? (
            <div className="flex items-baseline justify-between mb-2">
              <p className="font-bold text-lg text-foreground">
                {formatPrice(bestOffer.price, bestOffer.currency)}
              </p>
              {product.offers.length > 1 && (
                <span className="text-xs text-muted">
                  {product.offers.length} tedarikçi
                </span>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted mb-2">Fiyat için teklif alınız</p>
          )}

          {isFromDb && (
            <div className="flex items-center gap-1.5 text-[10px] text-amber-600 mb-2">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span>Fiyat ve stok talep öncesi tekrar doğrulanır</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Link
              href={`/request?supplierProductId=${encodeURIComponent(product.id)}&type=quote`}
              className="flex-1 inline-flex items-center justify-center bg-accent hover:bg-accent-dark text-white text-xs font-semibold py-2.5 rounded-md transition-colors"
            >
              Teklif Al
            </Link>
            <Link
              href={`/request?supplierProductId=${encodeURIComponent(product.id)}&type=compatibility`}
              className="flex-1 inline-flex items-center justify-center border border-border text-foreground text-xs font-semibold py-2.5 rounded-md hover:bg-surface transition-colors"
            >
              <ShieldCheck className="h-3.5 w-3.5 mr-1" />
              Uyumluluk
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProductCardCompact({ product }: ProductCardProps) {
  const bestOffer = product.offers.reduce(
    (best, offer) => (offer.price < best.price ? offer : best),
    product.offers[0],
  );
  const totalStock = product.offers.reduce(
    (sum, offer) => sum + offer.stockQuantity,
    0,
  );
  const isFromDb = product.dataSource === "existing-db";

  return (
    <Link
      href={`/request?supplierProductId=${encodeURIComponent(product.id)}&type=quote`}
      className="block border border-border rounded-lg bg-white hover:shadow-md hover:border-slate-300 transition-all group p-4"
    >
      <div className="flex items-start gap-3">
        <div className="w-16 h-16 bg-surface-alt rounded-md flex items-center justify-center shrink-0 overflow-hidden">
          {product.image_url ? (
            <img src={product.image_url} alt={product.name} className="w-full h-full object-contain p-1" loading="lazy" />
          ) : (
            <Package className="h-6 w-6 text-muted opacity-30" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            {product.brand && (
              <span className="text-[10px] font-medium bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{product.brand}</span>
            )}
            {isFromDb && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                <Database className="h-2.5 w-2.5" />
                Katalog
              </span>
            )}
          </div>
          <h3 className="font-medium text-sm text-foreground leading-snug truncate group-hover:text-accent transition-colors">
            {product.name}
          </h3>
          {totalStock > 0 ? (
            <span className="text-[10px] text-green-700 flex items-center gap-1 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Stokta
            </span>
          ) : (
            <span className="text-[10px] text-red-600">Stokta yok</span>
          )}
          {bestOffer && bestOffer.price > 0 && (
            <p className="font-bold text-sm text-foreground mt-1">
              {formatPrice(bestOffer.price, bestOffer.currency)}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}