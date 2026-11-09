// Side-effect free reading of REPXPERT vehicle type responses (linkageTargets/vehicle/TA-<id>?fields=FULL).

export const REPXPERT_ORIGIN = "https://www.repxpert.com.tr";
const QUERY = "fields=FULL&lang=tr&curr=RXP&catalogCountry=TR";

export const repxpertVehiclePath = (vehicleTypeId: number) => `/api/Repxpert-TR/linkageTargets/vehicle/TA-${vehicleTypeId}?${QUERY}`;

export type RepxpertVehicleSpecs = {
  fullName: string | null; bodyType: string | null; driveType: string | null; engineType: string | null; fuelMixture: string | null;
  cylinders: number | null; valves: number | null; engineCodes: string[]; kbaNumbers: string[];
  /** URL of the largest picture REPXPERT offers (keys are widths: 50…800). */
  imageUrl: string | null;
};

const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const count = (value: unknown) => Number.isInteger(value) && (value as number) > 0 && (value as number) < 100 ? value as number : null;
const texts = (value: unknown) => Array.isArray(value) ? [...new Set(value.map(text).filter((item): item is string => item !== null))] : [];

/** Reads a response body; throws when it is not a vehicle type (a block page or another document). */
export function parseRepxpertVehicle(body: unknown, vehicleTypeId: number): RepxpertVehicleSpecs {
  const data = body as Record<string, unknown> | null;
  if (!data || typeof data !== "object" || data.uuid !== `TA-${vehicleTypeId}`) throw new Error(`Response is not vehicle type TA-${vehicleTypeId}`);
  const entries = ((data.imageMap as { entry?: { key: string; value: string }[] } | undefined)?.entry ?? [])
    .filter(entry => Number(entry.key) > 0 && typeof entry.value === "string" && entry.value.startsWith(`${REPXPERT_ORIGIN}/`))
    .sort((a, b) => Number(b.key) - Number(a.key));
  return {
    fullName: text(data.fullName), bodyType: text(data.bodyType), driveType: text(data.driveType), engineType: text(data.engineType),
    fuelMixture: text(data.fuelMixtureFormation), cylinders: count(data.cylinders), valves: count(data.valves),
    engineCodes: texts(data.engineCodes), kbaNumbers: texts(data.kbaNumbers), imageUrl: entries[0]?.value ?? null,
  };
}

/** Akamai answers a blocked request with an HTML "Access denied" page instead of JSON. */
export const isRepxpertBlock = (status: number, body: string) => status === 403 || /Access denied|has been blocked due to security/i.test(body.slice(0, 2000));
