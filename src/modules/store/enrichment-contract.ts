import { z } from "zod";

const referenceNumbers = z.record(z.string().min(1), z.array(z.string().min(1).max(120)).max(500));
export const matchBasisSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("exact_part") }),
  z.object({ type: z.literal("oem_reference"), reference: z.string().min(1), supplierOem: z.string(),
    referenceSource: z.enum(["supplier_oem", "original_manufacturer_part_code"]) }),
  // Another manufacturer's product that lists the supplier's own brand and part number among its cross references
  // (an equivalent part). Its image and specifications describe the same part; its part number is never shown as ours.
  z.object({ type: z.literal("cross_reference"), reference: z.string().min(1), referenceBrand: z.string().min(1) }),
]);
export const enrichmentDataSchema = z.object({
  categories: z.array(z.object({source:z.literal("trodo"),id:z.number().int().positive(),name:z.string().min(1).max(300),
    path:z.array(z.object({id:z.number().int().positive(),name:z.string().min(1).max(300)})).max(30)})).max(100).default([]),
  displayName: z.string().min(1).max(300).optional(),
  description: z.string().max(3000).optional(),
  specifications: z.array(z.tuple([z.string().min(1).max(200), z.string().min(1).max(5000)])).max(100),
  oemNumbers: referenceNumbers,
  crossReferences: referenceNumbers,
  vehicles: z.array(z.object({
    model: z.string().min(1), engineAndCodes: z.string().min(1), fuel: z.string(),
    kw: z.number().positive(), ps: z.number().positive(), cc: z.number().nonnegative(),
    from: z.string().regex(/^(0[1-9]|1[0-2])\/\d{4}$/), to: z.string().regex(/^(0[1-9]|1[0-2])\/\d{4}$/).nullable(),
  }).refine(vehicle => vehicle.cc > 0 || /electric|hydrogen|fuel cell/i.test(vehicle.fuel), {
    message: "Zero displacement is only valid for electric, hydrogen and fuel-cell vehicles", path: ["cc"],
  })).max(50000),
  vehicleModels: z.array(z.string().min(1)).max(5000).default([]),
  imageWidth: z.number().int().positive().max(10000).default(480),
  imageHeight: z.number().int().positive().max(10000).default(480),
});
export type EnrichmentData = z.infer<typeof enrichmentDataSchema>;

export const enrichmentImportSchema = z.object({
  supplierItemId: z.uuid(), productId: z.uuid().optional(), supplierCode: z.string().min(1), supplierBrand: z.string().min(1),
  source: z.url().refine(value => new URL(value).protocol === "https:", "HTTPS source required"),
  sourceMethod: z.string().min(1), manufacturer: z.string().min(1), partNumber: z.string().min(1),
  completeness: z.enum(["complete", "partial"]),
  matchBasis: matchBasisSchema.default({ type: "exact_part" }),
  imageFile: z.string().optional(), imageSource: z.url().optional(),
  brandLogo: z.object({ imageFile: z.string().min(1), imageSource: z.url() }).optional(),
  data: enrichmentDataSchema,
});

const normalize = (value: string) => value.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/g, "");
const aliases: Record<string, string> = { FEBI: "FEBIBILSTEIN", MANN: "MANNFILTER", HENGST: "HENGSTFILTER" };
export const manufacturerBrandKey = (value: string) => aliases[normalize(value)] || normalize(value);
const brandKey = manufacturerBrandKey;
const prefixes: Record<string, string[]> = {
  DEPO: ["DPO"], LUK: ["LUK"], FEBIBILSTEIN: ["FEBI"], BOSCH: ["BOS", "BCH"], LEMFORDER: ["LEM"], BSG: ["BSG"],
  DENSO: ["DEN"], MANNFILTER: ["MANN"], ELRING: ["ELR"], CONTITECH: ["C", "CT", "CONTI"], TRW: ["TRW"],
  MOOG: ["MOOG"], SKF: ["SKF"], SACHS: ["SCH"], FAG: ["FAG"], PIERBURG: ["PRG"], CTR: ["CTR"],
  // Supplier prefixes verified against same-brand Trodo catalog candidates.
  FILTRON: ["FILT"], DAYCO: ["DAY"], TEXTAR: ["TX"], VDO: ["VDO"], ERA: ["ERA"], NGK: ["NGK"],
  GATES: ["GTS"], AISIN: ["AIS"], DELPHI: ["DEL"], NRF: ["NRF"], VALEO: ["VAL"], RAPRO: ["RAP"],
  CIFAM: ["CIF"], ATE: ["ATE"], ZF: ["ZF"], STABILUS: ["STB"], INA: ["INA"], HELLA: ["HEL"],
  HEPU: ["HEPU"], BLUEPRINT: ["BLU"], BREMI: ["BRM"], FERODO: ["FRD"], BERU: ["BR"],
  CHAMPION: ["CHA"], SOFIMA: ["SOF"], DOLZ: ["DOLZ"], PURFLUX: ["PUR"], WAHLER: ["WHL"],
  AE: ["AE"], JURID: ["JRD"], ULO: ["ULO"],
  HENGSTFILTER: ["HNG"],
  // Dinamik labels seen on spareto.com candidates of the same brand.
  CORTECO: ["COR"], OSRAM: ["OSR"], MANDO: ["MND"], GLYCO: ["GLY"], TIMKEN: ["TIM"],
};

/** A supplier row names its brand by its own label ("KRAFTVOLL BALATA"); the reviewed master brand it belongs to
 *  ("KRAFTVOLL") identifies the manufacturer just as well. */
export function matchesSupplierPart(supplierBrand: string, supplierCode: string, manufacturer: string, partNumber: string, masterBrand?: string | null) {
  return [supplierBrand, masterBrand].some(brand => brand && matchesBrandPart(brand, supplierCode, manufacturer, partNumber));
}
// Suppliers drop the leading zeros of all-digit catalogue numbers ("FEBI 2562" for FEBI 02562); within one brand an
// all-digit number names the same part with or without them.
const partKey = (value: string) => { const key = normalize(value); return /^\d+$/.test(key) ? key.replace(/^0+(?=\d)/, "") : key; };
function matchesBrandPart(supplierBrand: string, supplierCode: string, manufacturer: string, partNumber: string) {
  const brand = brandKey(supplierBrand);
  if (brand !== brandKey(manufacturer)) return false;
  if (partKey(supplierCode) === partKey(partNumber)) return true;
  const [prefix, ...rest] = supplierCode.trim().split(/\s+/);
  // Dinamik also prefixes codes with the brand's own name ("BOSCH 0986424533", "TEKNOROT HY-1044K").
  const known = (prefixes[brand] || []).includes(prefix.toUpperCase()) || brandKey(prefix) === brand;
  return known && rest.length > 0 && partKey(rest.join(" ")) === partKey(partNumber);
}

export function matchesEnrichment(supplier: { brand: string; code: string; oem: string; masterBrand?: string | null }, source: {
  manufacturer: string; partNumber: string; data: Pick<EnrichmentData, "oemNumbers" | "crossReferences">; matchBasis: z.infer<typeof matchBasisSchema>;
}) {
  const basis = source.matchBasis;
  if (basis.type === "exact_part") return matchesSupplierPart(supplier.brand, supplier.code, source.manufacturer, source.partNumber, supplier.masterBrand);
  if (basis.type === "cross_reference") return matchesSupplierPart(supplier.brand, supplier.code, basis.referenceBrand, basis.reference, supplier.masterBrand)
    && Object.entries(source.data.crossReferences).some(([brand, values]) => brand === basis.referenceBrand && values.some(value => normalize(value) === normalize(basis.reference)));
  if (supplier.oem !== basis.supplierOem) return false;
  const reference = normalize(basis.reference);
  if (!reference) return false;
  // Kit notation ("HX7G 6065 AB/SET") also authorizes the base OE number.
  const supplierReferences = supplier.oem.split(/[,;|\n]+|(?<=\d{7})\s+(?=\d{7})/)
    .flatMap(value => [value, value.trim().replace(/\s*\/\s*(?:SET|KIT|TAKIM)$/i, "")]).map(normalize).filter(value => value.length >= 4);
  const authorized = basis.referenceSource === "supplier_oem"
    ? supplierReferences.includes(reference)
    // An original manufacturer's own part number is an OE number, whatever its supplier OEM field holds.
    : /^OE-/.test(supplier.brand) && normalize(supplier.code) === reference;
  return authorized && (normalize(source.partNumber) === reference
    || [...Object.values(source.data.oemNumbers), ...Object.values(source.data.crossReferences)].flat().some(value => normalize(value) === reference));
}
