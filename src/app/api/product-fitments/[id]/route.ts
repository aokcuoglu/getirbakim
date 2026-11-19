import { z } from "zod";
import { compressedJson } from "@/lib/compressed-json";
import { getStorefrontProduct } from "@/modules/store/catalog";
import { getProductFitmentGroups } from "@/modules/store/product-fitment-data.server";
import { fitmentCacheControl } from "@/modules/store/product-fitment-view";

// A product's whole "Uyumlu araçlar" list, loaded when the visitor asks for more than the page prints (#966). The same
// for everyone (no cookies; src/proxy.ts leaves the session alone here), so browsers and the CDN keep it: long under
// the page's version (`?v=`), briefly otherwise. Route Handlers are not cached by Next.js.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const product = z.uuid().safeParse(id).success ? await getStorefrontProduct(id) : undefined;
    if (!product) return Response.json({ error: "Ürün bulunamadı." }, { status: 404, headers: { "Cache-Control": "public, max-age=60" } });
    const { v, groups } = await getProductFitmentGroups(product);
    return compressedJson(request, { v, groups }, { headers: { "Cache-Control": fitmentCacheControl(new URL(request.url).searchParams.get("v"), v) } });
  } catch (error) {
    console.error("Product fitments could not be loaded", error);
    return Response.json({ error: "Uyumlu araçlar yüklenemedi." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
