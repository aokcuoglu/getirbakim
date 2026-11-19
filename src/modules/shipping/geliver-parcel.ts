import { z } from "zod";

// Package sizes of a Geliver label (#960). Kept apart from geliver-request.ts so the ship dialog (a client component)
// does not bundle the province list or node:crypto.

export const parcelPresets = {
  small: { label: "Küçük", length: 20, width: 15, height: 10, weight: 1 },
  medium: { label: "Orta", length: 30, width: 25, height: 15, weight: 3 },
  large: { label: "Büyük", length: 50, width: 40, height: 30, weight: 10 },
} as const;
export type ParcelPreset = keyof typeof parcelPresets;
export const parcelPresetKeys = Object.keys(parcelPresets) as [ParcelPreset, ...ParcelPreset[]];

const decimal = (label: string, min: number, max: number, unit: string) => z.preprocess(
  value => typeof value === "string" ? value.trim().replace(",", ".") : value,
  z.coerce.number(`${label} sayı olmalı.`).min(min, `${label} en az ${min} ${unit} olmalı.`).max(max, `${label} en fazla ${max} ${unit} olabilir.`),
);
const customParcel = z.object({
  length: decimal("Uzunluk", 1, 200, "cm"), width: decimal("Genişlik", 1, 200, "cm"), height: decimal("Yükseklik", 1, 200, "cm"),
  weight: decimal("Ağırlık", 0.1, 100, "kg"),
});
/** Package of a label: one of the presets, or custom sizes in cm and weight in kg. */
export const parcelSchema = z.discriminatedUnion("preset", [
  z.object({ preset: z.enum(parcelPresetKeys) }),
  customParcel.extend({ preset: z.literal("custom") }),
], { error: "Paket boyutunu seçin." }).transform((value): { preset: ParcelPreset | "custom"; length: number; width: number; height: number; weight: number } => {
  if (value.preset === "custom") return value;
  const { length, width, height, weight } = parcelPresets[value.preset];
  return { preset: value.preset, length, width, height, weight };
});
export type Parcel = z.output<typeof parcelSchema>;
