"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, ShieldCheck, Clock } from "lucide-react";
import { OfferTable } from "@/components/offer-table";
import type { NormalizedProduct } from "@/types";
import { formatPrice } from "@/lib/utils";

interface ProductDetailData extends NormalizedProduct {
  lastCheckedAt?: string;
}

export default function ProductDetailContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [product, setProduct] = useState<ProductDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    fetch(`/api/products/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("Ürün bulunamadı");
        return res.json();
      })
      .then((data: ProductDetailData) => {
        if (!controller.signal.aborted) {
          setProduct(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [id]);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-24 mb-6" />
          <div className="h-8 bg-gray-200 rounded w-1/3 mb-4" />
          <div className="h-4 bg-gray-100 rounded w-1/4 mb-8" />
          <div className="h-48 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-8 text-center">
        <p className="text-lg text-gray-500 mb-4">{error ?? "Ürün bulunamadı"}</p>
        <Link href="/search?q=" className="text-sm text-black underline">
          Ürün aramaya dön
        </Link>
      </div>
    );
  }

  const bestOffer = product.offers.reduce(
    (best, offer) => (offer.price < best.price ? offer : best),
    product.offers[0]
  );
  const availableOffers = product.offers.filter((o) => o.isAvailable);

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      <Link
        href="/search?q="
        className="inline-flex items-center text-sm text-gray-500 hover:text-black mb-6 transition-colors"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Aramaya Dön
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
        <div className="lg:col-span-2">
          <h1 className="text-2xl sm:text-3xl font-bold text-black mb-2">
            {product.name}
          </h1>
          <div className="flex items-center gap-2 flex-wrap mb-4">
            {product.brand && (
              <span className="text-sm text-gray-600 font-medium">
                {product.brand}
              </span>
            )}
            {product.category && (
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                {product.category}
              </span>
            )}
            <span className="text-xs text-gray-400">
              {product.offers.length} tedarikçi
            </span>
          </div>

          {product.description && (
            <div className="mb-6">
              <p className="text-sm text-gray-600 leading-relaxed">
                {product.description}
              </p>
            </div>
          )}

          {product.oem_numbers.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-black mb-2">
                OEM / OEN Numaraları
              </h2>
              <div className="flex flex-wrap gap-2">
                {product.oem_numbers.map((oem) => (
                  <span
                    key={oem}
                    className="text-xs font-mono bg-gray-50 border border-gray-200 text-gray-700 px-2.5 py-1 rounded"
                  >
                    {oem}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-md mb-6">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />
              <p className="text-xs text-yellow-800 leading-relaxed">
                Bu ürün bazı araç versiyonlarında farklılık gösterebilir. Sipariş
                öncesi uyumluluk teyidi önerilir.
              </p>
            </div>
          </div>

          {product.lastCheckedAt && (
            <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4">
              <Clock className="h-3.5 w-3.5" />
              <span>
                Son kontrol zamanı: {new Date(product.lastCheckedAt).toLocaleString("tr-TR")}
              </span>
            </div>
          )}

          <div className="mb-6">
            <h2 className="text-lg font-semibold text-black mb-3">
              Tedarikçi Teklifleri ({product.offers.length})
            </h2>
            <OfferTable offers={product.offers} />
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="border border-gray-200 rounded-md p-5 bg-white sticky top-6">
            {bestOffer && (
              <div className="mb-4">
                <p className="text-sm text-gray-500 mb-1">En düşük fiyat</p>
                <p className="text-3xl font-bold text-black">
                  {formatPrice(bestOffer.price, bestOffer.currency)}
                </p>
              </div>
            )}

            <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
              {availableOffers.length > 0 ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  {availableOffers.length} tedarikçide stokta
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  Stokta yok
                </>
              )}
            </div>

            <Link
              href={`/request?productId=${encodeURIComponent(product.id)}`}
              className="block w-full bg-black text-white text-center px-6 py-3 text-sm font-medium hover:bg-gray-800 transition-colors rounded mb-3"
            >
              Talep Oluştur
            </Link>
            <Link
              href={`/request?productId=${encodeURIComponent(product.id)}`}
              className="flex items-center justify-center gap-1.5 w-full border border-gray-300 text-black text-center px-6 py-3 text-sm font-medium hover:bg-gray-50 transition-colors rounded"
            >
              <ShieldCheck className="h-4 w-4" />
              Uyumluluk Kontrolü İçin Talep Et
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}