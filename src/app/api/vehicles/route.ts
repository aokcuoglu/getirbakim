import { getVehicleBrands, getVehicleModels, getModelVehicles, searchVehicleCatalog } from "@/modules/store/vehicle-catalog.server";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim();
  if (query && query.length > 120) return Response.json({ error: "Arama en fazla 120 karakter olabilir." }, { status: 400 });
  const rawOffset = params.get("offset") ?? "0";
  const offset = Number(rawOffset);
  if (!Number.isSafeInteger(offset) || offset < 0) return Response.json({ error: "Geçersiz sayfa." }, { status: 400 });
  try {
    if (query) return Response.json(await searchVehicleCatalog(query, offset));
    const modelId = params.get("modelId"), brandId = params.get("brandId");
    if (modelId) {
      const vehicles = await getModelVehicles(modelId);
      return vehicles ? Response.json({ vehicles }) : Response.json({ error: "Model bulunamadı." }, { status: 404 });
    }
    if (brandId) {
      const models = await getVehicleModels(brandId);
      return models ? Response.json({ models }) : Response.json({ error: "Marka bulunamadı." }, { status: 404 });
    }
    return Response.json({ brands: await getVehicleBrands() });
  } catch (error) {
    console.error("Vehicle catalog could not be loaded", error);
    return Response.json({ error: "Araç verileri yüklenemedi. Lütfen tekrar dene." }, { status: 500 });
  }
}
