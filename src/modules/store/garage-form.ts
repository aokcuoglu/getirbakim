import { shownVehicle } from "./vehicle-label";
import type { GarageVehicle } from "./garage";

/** What the /garaj form's submission does to the garage (#689). */
export type GarageFormChange =
  | { kind: "keep"; vehicle: GarageVehicle }
  | { kind: "catalog-year"; vehicleId: string; year: number }
  | { kind: "text"; make: string; model: string; year: number };

/**
 * The form is pre-filled with the readable make and model; a submitted value equal to the label of the active vehicle is that
 * vehicle's stored value again, so saving the form never rewrites the stored make/model or the garage key ("Fiat" vs "FIAT"
 * lower-case differently in Turkish). A catalog vehicle keeps its type (fitment, maintenance kit, `fits`) unless the make or
 * model was edited; a changed year alone re-selects the same type for that year; only edited names become free text.
 */
export function garageFormChange(input: { make: string; model: string; year: number }, active: GarageVehicle | null): GarageFormChange {
  const shown = shownVehicle(active);
  const make = shown && input.make === shown.makeLabel ? shown.make : input.make;
  const model = shown && input.model === shown.modelLabel ? shown.model : input.model;
  if (active && make === active.make && model === active.model) {
    if (input.year === active.year) return { kind: "keep", vehicle: active };
    if (active.vehicleId) return { kind: "catalog-year", vehicleId: active.vehicleId, year: input.year };
    return { kind: "keep", vehicle: { ...active, year: input.year } };
  }
  return { kind: "text", make, model, year: input.year };
}
