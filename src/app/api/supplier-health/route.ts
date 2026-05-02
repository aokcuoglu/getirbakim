import { NextResponse } from "next/server";
import { checkAllSupplierHealth } from "@/suppliers/search";

export async function GET() {
  const health = await checkAllSupplierHealth();
  return NextResponse.json(health);
}