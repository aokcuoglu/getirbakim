import type { Metadata } from "next";
import { Suspense } from "react";
import ProductDetailContent from "./product-detail-content";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001";
    const res = await fetch(`${baseUrl}/api/products/${encodeURIComponent(id)}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return { title: "Ürün Detayı" };
    const product = await res.json();
    const title = `${product.name}${product.brand ? ` - ${product.brand}` : ""}`;
    return {
      title,
      description: product.description
        ? `${product.description.slice(0, 160)}`
        : `${product.name} yedek parça fiyat ve stok karşılaştırması.`,
      openGraph: {
        title,
        description: product.description
          ? product.description.slice(0, 160)
          : `${product.name} yedek parça fiyat ve stok karşılaştırması.`,
        type: "website",
      },
    };
  } catch {
    return { title: "Ürün Detayı" };
  }
}

export default function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-8">
          <div className="animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-24 mb-6" />
            <div className="h-8 bg-gray-200 rounded w-1/3 mb-4" />
            <div className="h-4 bg-gray-100 rounded w-1/4 mb-8" />
            <div className="h-48 bg-gray-100 rounded" />
          </div>
        </div>
      }
    >
      <ProductDetailContent params={params} />
    </Suspense>
  );
}