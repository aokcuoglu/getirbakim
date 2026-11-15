import { db } from "@/lib/db";
import { currentAppVersion } from "@/lib/app-version";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await db.query("SELECT 1 FROM accounts LIMIT 1");
    return Response.json(
      {
        status: "ok",
        // Unchanged for existing checks: the runtime BUILD_VERSION, "development" when the image does not set it.
        version: process.env.BUILD_VERSION || "development",
        // Inlined at build time (#628, src/lib/app-version.ts), so they hold even when the runtime env is empty.
        release: currentAppVersion.version,
        commit: currentAppVersion.commit,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
