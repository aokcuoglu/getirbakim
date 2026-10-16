import "server-only";
import { db } from "@/lib/db";
import { vehicleModelImageAttribution, type VehicleModelImage } from "./vehicle-model-images";

type ImageRow = { model_id: string; media_id: string; sha256: string; width: number; height: number; author: string | null; license: string; source_url: string };

function formatImage(row: ImageRow): VehicleModelImage {
  return { src: `/api/vehicle-media/${row.media_id}?v=${row.sha256.slice(0, 16)}`, width: row.width, height: row.height,
    attribution: vehicleModelImageAttribution(row), sourceUrl: row.source_url };
}

/** Approved photographs for model series ids (TecDoc integers as strings); models without one are absent. */
export async function getVehicleModelImages(modelIds: string[]) {
  const images = new Map<string, VehicleModelImage>();
  const ids = [...new Set(modelIds.filter(id => /^\d{1,10}$/.test(id)))];
  if (!ids.length) return images;
  const { rows } = await db.query<ImageRow>(`SELECT i.model_id::text, i.media_id, m.sha256, i.width, i.height, i.author, i.license, i.source_url
    FROM vehicle_model_images i JOIN product_media_objects m ON m.id=i.media_id
    WHERE i.status='approved' AND i.model_id=ANY($1::int[])`, [ids]);
  for (const row of rows) images.set(row.model_id, formatImage(row));
  return images;
}
