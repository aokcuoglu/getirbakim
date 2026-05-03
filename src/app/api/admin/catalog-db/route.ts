import { NextResponse } from "next/server";
import { getCatalogDbStats } from "@/lib/catalog-search";

export async function GET() {
  const stats = await getCatalogDbStats();
  return NextResponse.json(stats);
}