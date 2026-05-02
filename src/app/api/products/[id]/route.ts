import { NextRequest, NextResponse } from "next/server";
import { getProductDetails } from "@/suppliers/search";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const product = await getProductDetails(decodeURIComponent(id));

  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  return NextResponse.json({
    ...product,
    lastCheckedAt: new Date().toISOString(),
  });
}