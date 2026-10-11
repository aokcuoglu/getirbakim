import { searchSuggestions } from "@/modules/store/search-suggestions";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim() ?? "";
  if (query.length > 120) return Response.json({ error: "Arama en fazla 120 karakter olabilir." }, { status: 400 });
  try {
    const suggestions = await searchSuggestions(query, params.get("searchBy") === "code" ? "code" : "all");
    // Same query, same answer for a minute: typing back and forth does not repeat the search.
    return Response.json(suggestions, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (error) {
    console.error("Search suggestions could not be loaded", error);
    return Response.json({ error: "Öneriler yüklenemedi." }, { status: 500 });
  }
}
