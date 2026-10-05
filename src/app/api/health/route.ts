import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await db.query("SELECT 1 FROM accounts LIMIT 1");
    return Response.json(
      { status: "ok", version: process.env.BUILD_VERSION || "development" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
