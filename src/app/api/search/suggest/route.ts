import { searchSuggestions } from "@/modules/store/search-suggestions";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim() ?? "";
  if (query.length > 120) return Response.json({ error: "Arama en fazla 120 karakter olabilir." }, { status: 400 });
  try {
    // request.signal aborts when the connection closes before the answer was sent (#1398); the search box aborts its
    // fetch on the next keystroke. Next 16.3.8 builds a route handler's request with signalFromNodeResponse(res)
    // (node_modules/next/dist/build/templates/app-route.js:214), which aborts on the response's 'close' unless it was
    // writableFinished (node_modules/next/dist/server/web/spec-extension/adapters/next-request.js:45-62). Page renders get
    // no such signal, so only this route cancels its reads.
    const suggestions = await searchSuggestions(query, params.get("searchBy") === "code" ? "code" : "all", { signal: request.signal });
    // Same query, same answer for a minute: typing back and forth does not repeat the search.
    return Response.json(suggestions, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (error) {
    // Nobody reads this answer: its reads were cancelled (boundedQuery logs that), not failed. 499: client closed request.
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error("Search suggestions could not be loaded", error);
    return Response.json({ error: "Öneriler yüklenemedi." }, { status: 500 });
  }
}
