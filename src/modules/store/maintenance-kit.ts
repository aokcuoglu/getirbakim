// Maintenance kit prototype (#172): shared by the live preview (browser) and the server-rendered image.
// The kit picture is composed from layers instead of being designed per combination: a template
// (panel, title, contents line) plus one packshot per slot. Packaging looks the same for every part of a
// brand and type, so a slot shows, in order: the brand × part type packaging cut-out from the packshot
// library (public/kit-packshots), the product photo (white background dropped with a multiply blend),
// or a generic box drawn in the brand's colours.

export const kitSlotKeys = ["air", "oil", "cabin", "fuel", "engineOil"] as const;
export type KitSlotKey = (typeof kitSlotKeys)[number];
export type KitFilterKey = Exclude<KitSlotKey, "engineOil">;

export const kitSlots: Record<KitSlotKey, { label: string; short: string; lines: string[] }> = {
  air: { label: "Hava filtresi", short: "HAVA", lines: ["Air filter", "Luftfilter", "Filtre à air"] },
  oil: { label: "Yağ filtresi", short: "YAĞ", lines: ["Oil filter", "Ölfilter", "Filtre à huile"] },
  cabin: { label: "Polen filtresi", short: "POLEN", lines: ["Cabin filter", "Innenraumfilter", "Filtre d'habitacle"] },
  fuel: { label: "Yakıt filtresi", short: "YAKIT", lines: ["Fuel filter", "Kraftstofffilter", "Filtre à carburant"] },
  engineOil: { label: "Motor yağı", short: "MOTOR YAĞI", lines: [] },
};

export type KitImage = { src: string; width: number; height: number };
export type KitItem = {
  id: string; name: string; brand: string; family: string; code: string; priceKurus: number;
  image?: KitImage; packshot?: KitImage; viscosity?: string; liters?: string;
};
export type KitSlotOptions = { key: KitSlotKey; items: KitItem[]; fitted: boolean };
export type KitSelection = Partial<Record<KitSlotKey, KitItem>>;

/** Supplier brand spellings grouped into the brand a shopper picks ("BOSCH-AV" is still Bosch). */
export const filterBrandFamilies: Record<string, { name: string; raw: string[] }> = {
  BOSCH: { name: "Bosch", raw: ["BOSCH", "BOSCH-AV"] },
  MANN: { name: "MANN-FILTER", raw: ["MANN", "MANN-AV"] },
  MAHLE: { name: "MAHLE", raw: ["MAHLE", "MAHLE FILTRE"] },
  FILTRON: { name: "Filtron", raw: ["FILTRON", "FILTRON-AV"] },
  UFI: { name: "UFI", raw: ["UFI", "UFI FILTRE"] },
  HENGST: { name: "Hengst", raw: ["HENGST"] },
  PURFLUX: { name: "Purflux", raw: ["PURFLUX"] },
  FEBI: { name: "febi", raw: ["FEBI", "FEBI-AV"] },
  BLUEPRINT: { name: "Blue Print", raw: ["BLUEPRINT", "BLUE PRINT"] },
  SAKURA: { name: "Sakura", raw: ["SAKURA"] },
  VALEO: { name: "Valeo", raw: ["VALEO", "VALEO-AV"] },
  CORTECO: { name: "Corteco", raw: ["CORTECO"] },
};
export const familyOfRawBrand = (brand: string) =>
  Object.entries(filterBrandFamilies).find(([, family]) => family.raw.includes(brand))?.[0] ?? brand;
export const familyName = (family: string) => filterBrandFamilies[family]?.name ?? titleCase(family.replace(/ - YAG$| YAGLAR$/, ""));

function titleCase(value: string) {
  return value.toLocaleLowerCase("tr").replace(/(^|\s)(\p{L})/gu, (_, space: string, letter: string) => space + letter.toLocaleUpperCase("tr"));
}

type Palette = { body: string; side: string; top: string; accent: string; text: string };
const palettes: Record<string, Palette> = {
  BOSCH: { body: "#16306b", side: "#0e2150", top: "#2a4b8f", accent: "#e2001a", text: "#ffffff" },
  MANN: { body: "#0a7a3e", side: "#065a2d", top: "#1f9a57", accent: "#ffffff", text: "#ffffff" },
  MAHLE: { body: "#0c55a4", side: "#083f7b", top: "#2a74c4", accent: "#ffffff", text: "#ffffff" },
  FILTRON: { body: "#f2b705", side: "#c99503", top: "#f8cf47", accent: "#1d1d1b", text: "#1d1d1b" },
  UFI: { body: "#0b3f8c", side: "#072d66", top: "#285fae", accent: "#e30613", text: "#ffffff" },
  HENGST: { body: "#0b5aa8", side: "#08427c", top: "#2a78c6", accent: "#ffffff", text: "#ffffff" },
  PURFLUX: { body: "#d9001b", side: "#a30014", top: "#ee3347", accent: "#ffffff", text: "#ffffff" },
  FEBI: { body: "#ffd200", side: "#d4ae00", top: "#ffe154", accent: "#003a70", text: "#003a70" },
  BLUEPRINT: { body: "#00519e", side: "#003b74", top: "#1f70bf", accent: "#ffffff", text: "#ffffff" },
  SAKURA: { body: "#c8102e", side: "#960b22", top: "#df3a55", accent: "#ffffff", text: "#ffffff" },
  VALEO: { body: "#00a04f", side: "#00773b", top: "#27bb6d", accent: "#ffffff", text: "#ffffff" },
  CORTECO: { body: "#e30613", side: "#ab040e", top: "#f2343f", accent: "#ffffff", text: "#ffffff" },
  TOTAL: { body: "#d40f14", side: "#9e0b0f", top: "#e8383c", accent: "#ffffff", text: "#ffffff" },
  ELF: { body: "#0a2f6e", side: "#072352", top: "#1f4a92", accent: "#e30613", text: "#ffffff" },
  "CHAMPION - YAG": { body: "#1a1a1a", side: "#000000", top: "#3a3a3a", accent: "#d4a017", text: "#ffffff" },
};
const fallbackPalettes: Palette[] = [
  { body: "#334155", side: "#1e293b", top: "#475569", accent: "#f59e0b", text: "#ffffff" },
  { body: "#0f766e", side: "#115e59", top: "#14b8a6", accent: "#ffffff", text: "#ffffff" },
  { body: "#7c2d12", side: "#5a200d", top: "#9a3412", accent: "#fde68a", text: "#ffffff" },
  { body: "#4338ca", side: "#312e81", top: "#6366f1", accent: "#ffffff", text: "#ffffff" },
];
function paletteFor(family: string) {
  if (palettes[family]) return palettes[family];
  let hash = 0;
  for (const char of family) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return fallbackPalettes[hash % fallbackPalettes.length];
}

const escapeXml = (value: string) => value.replace(/[<>&"']/g, char => `&#${char.charCodeAt(0)};`);
const font = "Inter, 'Helvetica Neue', Arial, sans-serif";

/** Natural packshot sizes in canvas units (the canvas is 1000 × 1000). */
const packshotSize: Record<KitSlotKey, { width: number; height: number }> = {
  air: { width: 400, height: 330 },
  oil: { width: 200, height: 200 },
  cabin: { width: 200, height: 500 },
  fuel: { width: 190, height: 250 },
  engineOil: { width: 230, height: 320 },
};
export const kitCanvas = 1000;
const floor = 905;

export type KitLayer = { key: KitSlotKey; item: KitItem; x: number; y: number; width: number; height: number; z: number };

/** Packaging cut-outs keep their own proportions at the slot's height; drawn boxes use the fixed size. */
function slotSize(key: KitSlotKey, item: KitItem) {
  const size = packshotSize[key];
  if (!item.packshot) return size;
  const aspect = Math.min(2.4, Math.max(0.3, item.packshot.width / item.packshot.height));
  const width = Math.min(size.height * aspect, size.width * 1.6);
  return { width, height: width / aspect };
}

/**
 * Places the selected packshots: filters stand in a back row (air, oil, fuel, cabin, overlapping a
 * little), the oil can stands in front of the middle. Works for any subset, so no per-combination
 * template is needed.
 */
export function kitLayout(selection: KitSelection): KitLayer[] {
  const rowOrder: KitFilterKey[] = ["air", "oil", "fuel", "cabin"];
  const depth: Record<KitSlotKey, number> = { cabin: 1, air: 2, fuel: 3, oil: 4, engineOil: 5 };
  const row = rowOrder.filter(key => selection[key]);
  const overlap = 0.14;
  const sizes = row.map(key => slotSize(key, selection[key]!));
  const widths = sizes.map(size => size.width);
  const rowWidth = widths.reduce((sum, width, index) => sum + width - (index ? overlap * Math.min(width, widths[index - 1]) : 0), 0);
  const scale = row.length ? Math.min(1.25, 880 / rowWidth) : 1;
  const layers: KitLayer[] = [];
  let x = 520 - (rowWidth * scale) / 2;
  row.forEach((key, index) => {
    const size = sizes[index];
    if (index) x -= overlap * Math.min(size.width, widths[index - 1]) * scale;
    const width = size.width * scale, height = size.height * scale;
    // Small boxes stand a step forward, in front of the big air filter box.
    const forward = key === "oil" || key === "fuel" ? 30 : 0;
    layers.push({ key, item: selection[key]!, x, y: floor + forward - height, width, height, z: depth[key] });
    x += width;
  });
  if (selection.engineOil) {
    const size = slotSize("engineOil", selection.engineOil), oilScale = Math.min(1.15, Math.max(0.9, scale));
    const width = size.width * oilScale, height = size.height * oilScale;
    // In front of the right edge of the small boxes (or the gap between two big ones), so every box stays visible.
    const small = layers.filter(layer => layer.key === "oil" || layer.key === "fuel").at(-1);
    const anchor = small ?? (layers.length > 1 ? layers.at(-2) : undefined);
    const centre = anchor ? Math.min(kitCanvas - width / 2 - 20, anchor.x + anchor.width + width * 0.4) : 520;
    layers.push({ key: "engineOil", item: selection.engineOil, x: centre - width / 2, y: floor + 55 - height, width, height, z: depth.engineOil });
  }
  return layers.sort((a, b) => a.z - b.z);
}

const countWords: Record<number, string> = { 1: "TEKLİ", 2: "2'Lİ", 3: "3'LÜ", 4: "4'LÜ", 5: "5'Lİ" };

/** Template layer: background, title panel and floor shadows. Text stays text, so it never needs redesigning. */
export function kitBaseSvg(selection: KitSelection, layers = kitLayout(selection)) {
  const filters = (["air", "oil", "cabin", "fuel"] as const).filter(key => selection[key]);
  const oil = selection.engineOil;
  const count = layers.length;
  const contents = filters.map(key => kitSlots[key].short).join("-") || "MOTOR YAĞI";
  const oilLine = oil ? `${familyName(oil.family).toLocaleUpperCase("tr")}${oil.viscosity ? " " + oil.viscosity : ""} MOTOR YAĞI${oil.liters ? " · " + oil.liters : ""}` : "";
  const title = filters.length ? (oil ? "Bakım Seti" : "Filtre Seti") : "Motor Yağı";
  const shadows = layers.map(layer => `<ellipse cx="${(layer.x + layer.width / 2).toFixed(1)}" cy="${(layer.y + layer.height - 4).toFixed(1)}" rx="${(layer.width * 0.52).toFixed(1)}" ry="${Math.max(10, layer.width * 0.07).toFixed(1)}" fill="url(#shadow)"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${kitCanvas} ${kitCanvas}" width="${kitCanvas}" height="${kitCanvas}">
<defs>
<linearGradient id="panel" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="#5fd0c3"/><stop offset="1" stop-color="#1c9c8f"/></linearGradient>
<radialGradient id="shadow"><stop offset="0" stop-color="#0f172a" stop-opacity="0.35"/><stop offset="1" stop-color="#0f172a" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${kitCanvas}" height="${kitCanvas}" fill="#ffffff"/>
<rect x="60" y="50" width="560" height="560" rx="8" fill="url(#panel)"/>
${count ? `<text x="100" y="215" font-family="${font}" font-size="170" font-weight="700" fill="#16314f" letter-spacing="-6">${escapeXml(countWords[count] ?? `${count}'Lİ`)}</text>` : ""}
<text x="104" y="305" font-family="${font}" font-size="74" font-weight="700" fill="#ffffff">${escapeXml(title)}</text>
<text x="106" y="360" font-family="${font}" font-size="40" font-weight="700" fill="#ffffff">${escapeXml(contents)}</text>
${oilLine ? `<text x="106" y="402" font-family="${font}" font-size="24" font-weight="500" fill="#ffffff">${escapeXml(oilLine.slice(0, 44))}</text>` : ""}
${shadows}
</svg>`;
}

/** Generic box (filters) or can (engine oil) in the brand's colours, sized for `kitLayout`. */
export function packshotSvg(key: KitSlotKey, item: Pick<KitItem, "family" | "viscosity" | "liters">) {
  const { width, height } = packshotSize[key];
  const palette = paletteFor(item.family);
  const brand = escapeXml(familyName(item.family).toLocaleUpperCase("tr"));
  if (key === "engineOil") {
    const viscosity = escapeXml(item.viscosity ?? "");
    const liters = escapeXml(item.liters ?? "");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
<rect x="34" y="8" width="54" height="34" rx="6" fill="${palette.accent === "#ffffff" ? "#e5e7eb" : palette.accent}"/>
<path d="M22 60 Q22 40 44 40 L150 40 Q170 40 184 54 L212 86 Q222 98 222 114 L222 296 Q222 316 202 316 L30 316 Q10 316 10 296 L10 76 Q10 60 22 60 Z" fill="${palette.body}"/>
<path d="M150 52 L186 92 L186 150 L160 150 L160 92 L140 70 Z" fill="${palette.side}" opacity="0.9"/>
<path d="M10 76 Q10 60 22 60 L36 60 L36 316 L30 316 Q10 316 10 296 Z" fill="#ffffff" opacity="0.12"/>
<rect x="28" y="150" width="176" height="140" rx="10" fill="#ffffff"/>
<rect x="28" y="150" width="176" height="34" rx="10" fill="${palette.accent === "#ffffff" ? palette.side : palette.accent}"/>
<text x="116" y="174" text-anchor="middle" font-family="${font}" font-size="${brand.length > 9 ? 15 : 20}" font-weight="800" fill="#ffffff">${brand}</text>
<text x="116" y="232" text-anchor="middle" font-family="${font}" font-size="${viscosity.length > 6 ? 30 : 40}" font-weight="800" fill="${palette.body === "#ffd200" ? "#003a70" : palette.body}">${viscosity}</text>
<text x="116" y="258" text-anchor="middle" font-family="${font}" font-size="15" font-weight="700" fill="#334155">MOTOR YAĞI</text>
<text x="116" y="280" text-anchor="middle" font-family="${font}" font-size="14" font-weight="600" fill="#64748b">${liters}</text>
</svg>`;
  }
  // Box in three-quarter view: front face, right side and lid.
  const depthX = Math.round(width * 0.2), depthY = Math.round(depthX * 0.55);
  const frontW = width - depthX, frontTop = depthY;
  const lines = kitSlots[key].lines;
  const big = Math.min(frontW * 0.2, 54), small = Math.max(11, Math.min(frontW * 0.065, 17));
  const typeLabel = escapeXml(kitSlots[key].label);
  const linesSvg = [kitSlots[key].label, ...lines].map((line, index) =>
    `<text x="${(frontW * 0.1).toFixed(1)}" y="${(frontTop + height * 0.5 + index * small * 1.45).toFixed(1)}" font-family="${font}" font-size="${(index ? small : small * 1.15).toFixed(1)}" font-weight="${index ? 500 : 700}" fill="${palette.text}" opacity="${index ? 0.85 : 1}">${escapeXml(line)}</text>`).join("");
  const tall = height > width * 1.6;
  const wordmark = tall
    ? `<text transform="translate(${(frontW * 0.62).toFixed(1)} ${(frontTop + 18).toFixed(1)}) rotate(-90)" text-anchor="end" font-family="${font}" font-size="${Math.min(frontW * 0.3, 48).toFixed(1)}" font-weight="800" fill="${palette.accent}" letter-spacing="2">${brand}</text>`
    : `<rect x="0" y="${(frontTop + height * 0.1).toFixed(1)}" width="${frontW}" height="${(big * 1.45).toFixed(1)}" fill="${palette.accent}" opacity="${palette.accent === "#ffffff" ? 0.14 : 1}"/>
<text x="${(frontW * 0.1).toFixed(1)}" y="${(frontTop + height * 0.1 + big * 1.08).toFixed(1)}" font-family="${font}" font-size="${big.toFixed(1)}" font-weight="800" fill="${palette.accent === "#ffffff" || palette.accent === palette.text ? palette.text : "#ffffff"}" letter-spacing="1">${brand}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
<polygon points="0,${frontTop} ${depthX},0 ${width},0 ${frontW},${frontTop}" fill="${palette.top}"/>
<polygon points="${frontW},${frontTop} ${width},0 ${width},${height - depthY} ${frontW},${height}" fill="${palette.side}"/>
<rect x="0" y="${frontTop}" width="${frontW}" height="${height - frontTop}" fill="${palette.body}"/>
${wordmark}
${tall ? `<text transform="translate(${(frontW * 0.26).toFixed(1)} ${(frontTop + 18).toFixed(1)}) rotate(-90)" text-anchor="end" font-family="${font}" font-size="${small.toFixed(1)}" font-weight="700" fill="${palette.text}">${typeLabel.toLocaleUpperCase("tr")}</text>` : linesSvg}
<text x="${(frontW * 0.1).toFixed(1)}" y="${(height - 12).toFixed(1)}" font-family="${font}" font-size="${Math.max(10, small * 0.8).toFixed(1)}" fill="${palette.text}" opacity="0.7">${tall ? "" : "1 Pc"}</text>
</svg>`;
}

export const svgDataUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** Query string of the server-rendered kit image; slot order is fixed, so equal kits share one URL. */
export function kitImageQuery(selection: KitSelection) {
  const query = new URLSearchParams();
  for (const key of kitSlotKeys) if (selection[key]) query.set(key, selection[key]!.id);
  return query.toString();
}
/** Bumped whenever the template or layout changes, so cached images are not reused. */
export const kitTemplateVersion = "1";

export function parseViscosity(name: string) {
  const match = name.match(/\b(\d{1,2})W-?(\d{2})\b/i);
  return match ? `${match[1]}W-${match[2]}` : undefined;
}
export function parseLiters(name: string) {
  const match = name.match(/(\d+(?:[.,]\d+)?)\s*(?:L|LT|LITRE)\b/i);
  return match ? `${match[1].replace(".", ",")} L` : undefined;
}
