// Why an import was saved as partial, read from the adapter's source_method note; shared by the admin page and the
// image-fill pass (which may complete a product once its image is the only gap).
export type PartialGap = "image" | "no_vehicles" | "vehicles_not_collected" | "unresolved_vehicles" | "invalid_rows" | "failed_makes";
/** Why an import was saved as partial, read from the adapter's source_method note (Trodo, otoparcasan or spareto). */
export function partialGaps(sourceMethod: string | null, hasImage: boolean): PartialGap[] {
  const gaps: PartialGap[] = [];
  if (!hasImage) gaps.push("image");
  if (!sourceMethod) return gaps;
  const pair = (label: string) => { const found = new RegExp(`${label} (\\d+)/(\\d+)`).exec(sourceMethod); return found ? [Number(found[1]), Number(found[2])] : null; };
  const count = (label: string) => Number(new RegExp(`${label} (\\d+)`).exec(sourceMethod)?.[1] ?? 0);
  const covered = pair("source IDs covered") ?? pair("vehicle models");
  if (/vehicles not collected/.test(sourceMethod)) gaps.push("vehicles_not_collected");
  else if (/no vehicles listed/.test(sourceMethod)) gaps.push("no_vehicles");
  else if (covered && covered[0] < covered[1]) gaps.push("unresolved_vehicles");
  if (count("invalid rows")) gaps.push("invalid_rows");
  if (count("failed makes")) gaps.push("failed_makes");
  return gaps;
}

/** Whether adding an image closes the last gap of a partial import, from its source_method note. */
export const completeWithImage = (sourceMethod: string | null) => partialGaps(sourceMethod, true).length === 0;

/** The import note after an image from another source: the "no image" mark goes, the image's origin is recorded. */
export const imageNote = (sourceMethod: string, imageSource: string) => `${sourceMethod.replace(/; no image\b/, "")}; image from ${new URL(imageSource).hostname}`;

/** A partial package from another source is refused when the stored partial lists more vehicles; the same source may
 *  always rewrite its own partial (a re-collect is its newer view). Complete packages are never refused here. */
export const keepsRicherPartial = (stored: { source: string; vehicles: number }, next: { source: string; vehicles: number }) =>
  new URL(stored.source).hostname !== new URL(next.source).hostname && stored.vehicles > next.vehicles;
