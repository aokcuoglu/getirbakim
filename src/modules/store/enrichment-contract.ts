import { z } from "zod";

const referenceNumbers = z.record(z.string().min(1), z.array(z.string().min(1).max(120)).max(500));
export const matchBasisSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("exact_part") }),
  z.object({ type: z.literal("oem_reference"), reference: z.string().min(1), supplierOem: z.string(),
    referenceSource: z.enum(["supplier_oem", "original_manufacturer_part_code"]) }),
]);
export const enrichmentDataSchema = z.object({
  displayName: z.string().min(1).max(300).optional(),
  description: z.string().max(3000).optional(),
  specifications: z.array(z.tuple([z.string().min(1).max(200), z.string().min(1).max(1000)])).max(100),
  oemNumbers: referenceNumbers,
  crossReferences: referenceNumbers,
  vehicles: z.array(z.object({
    model: z.string().min(1), engineAndCodes: z.string().min(1), fuel: z.string(),
    kw: z.number().positive(), ps: z.number().positive(), cc: z.number().nonnegative(),
    from: z.string().regex(/^(0[1-9]|1[0-2])\/\d{4}$/), to: z.string().regex(/^(0[1-9]|1[0-2])\/\d{4}$/).nullable(),
  }).refine(vehicle => vehicle.cc > 0 || vehicle.fuel === "Electric", {
    message: "Zero displacement is only valid for electric vehicles", path: ["cc"],
  })).max(10000),
  vehicleModels: z.array(z.string().min(1)).max(500).default([]),
  imageWidth: z.number().int().positive().max(10000).default(480),
  imageHeight: z.number().int().positive().max(10000).default(480),
});
export type EnrichmentData = z.infer<typeof enrichmentDataSchema>;

export const enrichmentImportSchema = z.object({
  supplierItemId: z.uuid(), supplierCode: z.string().min(1), supplierBrand: z.string().min(1),
  source: z.url().refine(value => new URL(value).protocol === "https:", "HTTPS source required"),
  sourceMethod: z.string().min(1), manufacturer: z.string().min(1), partNumber: z.string().min(1),
  completeness: z.enum(["complete", "partial"]),
  matchBasis: matchBasisSchema.default({ type: "exact_part" }),
  imageFile: z.string().optional(), imageSource: z.url().optional(),
  brandLogo: z.object({ imageFile: z.string().min(1), imageSource: z.url() }).optional(),
  data: enrichmentDataSchema,
});

const normalize = (value: string) => value.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/g, "");
const aliases: Record<string, string> = { FEBI: "FEBIBILSTEIN", MANN: "MANNFILTER" };
export const manufacturerBrandKey = (value: string) => aliases[normalize(value)] || normalize(value);
const brandKey = manufacturerBrandKey;
const prefixes: Record<string, string[]> = {
  DEPO: ["DPO"], LUK: ["LUK"], FEBIBILSTEIN: ["FEBI"], BOSCH: ["BOS", "BCH"], LEMFORDER: ["LEM"], BSG: ["BSG"],
  DENSO: ["DEN"], MANNFILTER: ["MANN"], ELRING: ["ELR"], CONTITECH: ["C", "CT"], TRW: ["TRW"],
  MOOG: ["MOOG"], SKF: ["SKF"], SACHS: ["SCH"], FAG: ["FAG"], PIERBURG: ["PRG"], CTR: ["CTR"],
};

export function matchesSupplierPart(supplierBrand: string, supplierCode: string, manufacturer: string, partNumber: string) {
  const brand = brandKey(supplierBrand);
  if (brand !== brandKey(manufacturer)) return false;
  if (normalize(supplierCode) === normalize(partNumber)) return true;
  const [prefix, ...rest] = supplierCode.trim().split(/\s+/);
  return (prefixes[brand] || []).includes(prefix.toUpperCase()) && normalize(rest.join(" ")) === normalize(partNumber);
}

export function matchesEnrichment(supplier: { brand: string; code: string; oem: string }, source: {
  manufacturer: string; partNumber: string; data: EnrichmentData; matchBasis: z.infer<typeof matchBasisSchema>;
}) {
  const basis = source.matchBasis;
  if (basis.type === "exact_part") return matchesSupplierPart(supplier.brand, supplier.code, source.manufacturer, source.partNumber);
  if (supplier.oem !== basis.supplierOem) return false;
  const reference = normalize(basis.reference);
  if (!reference) return false;
  const supplierReferences = supplier.oem.split(/[,;|\n]+|(?<=\d{7})\s+(?=\d{7})/).map(normalize);
  const authorized = basis.referenceSource === "supplier_oem"
    ? supplierReferences.includes(reference)
    : !supplier.oem && /^OE-/.test(supplier.brand) && normalize(supplier.code) === reference;
  return authorized && (normalize(source.partNumber) === reference
    || [...Object.values(source.data.oemNumbers), ...Object.values(source.data.crossReferences)].flat().some(value => normalize(value) === reference));
}
