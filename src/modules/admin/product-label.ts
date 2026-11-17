/**
 * A product's name as "<brand> <code>" (#869): a supplier code often starts with the brand already ("SWAG 20928617"),
 * then the code alone, so the brand is not printed twice.
 */
export function fitmentSourceLabel(brandLabel: string, code: string): string {
  const brand = brandLabel.trim();
  if (!brand) return code;
  // Turkish upper case, dotted and dotless I alike: "Febi" and "FEBI", "ipek" and "İPEK" are the same brand.
  const upper = (text: string) => text.toLocaleUpperCase("tr").replaceAll("İ", "I");
  return upper(code).startsWith(`${upper(brand)} `) ? code : `${brand} ${code}`;
}

/** A vehicle model's production years as "2006–2013" ("2019–" while it runs), the way "Araç ekle" lists them (#888); null without a start. */
export function modelYearRange(from: string | null, to: string | null): string | null {
  return from ? `${from.slice(0, 4)}–${to?.slice(0, 4) ?? ""}` : null;
}

/** A model name with its years: "COROLLA (2006–2013)". */
export const modelLabel = (name: string, years: string | null) => years ? `${name} (${years})` : name;
