import type { NormalizedOffer } from "@/types";
import { formatPrice } from "@/lib/utils";

interface OfferTableProps {
  offers: NormalizedOffer[];
}

export function OfferTable({ offers }: OfferTableProps) {
  if (offers.length === 0) {
    return (
      <div className="text-sm text-gray-500 py-4">
        Bu ürün için şu anda teklif bulunmamaktadır.
      </div>
    );
  }

  const sorted = [...offers].sort((a, b) => a.price - b.price);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-2.5 pr-4 font-semibold text-gray-600">
              Tedarikçi
            </th>
            <th className="text-right py-2.5 pr-4 font-semibold text-gray-600">
              Fiyat
            </th>
            <th className="text-right py-2.5 pr-4 font-semibold text-gray-600">
              Stok
            </th>
            <th className="text-right py-2.5 font-semibold text-gray-600">
              Teslimat
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((offer, idx) => (
            <tr
              key={`${offer.supplierId}-${offer.supplierSku}`}
              className={`border-b border-gray-100 ${
                idx === 0 ? "bg-green-50/50" : ""
              }`}
            >
              <td className="py-2.5 pr-4">
                <span className="font-medium text-black">
                  {offer.supplierName}
                </span>
                {idx === 0 && (
                  <span className="ml-2 text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                    En düşük
                  </span>
                )}
                <span className="text-gray-400 ml-1 text-xs">
                  {offer.supplierSku}
                </span>
              </td>
              <td className="py-2.5 pr-4 text-right font-semibold">
                {formatPrice(offer.price, offer.currency)}
              </td>
              <td className="py-2.5 pr-4 text-right">
                {offer.isAvailable ? (
                  <span className="text-green-700">
                    {offer.stockQuantity} adet
                  </span>
                ) : (
                  <span className="text-red-600">Stokta yok</span>
                )}
              </td>
              <td className="py-2.5 text-right text-gray-600">
                {offer.deliveryDays ? `${offer.deliveryDays} gün` : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}