import { createHash } from "node:crypto";

/**
 * Source placeholder images that are not product photos (#1098): "Image coming soon" tiles, generic illustrations,
 * multilingual legal notices. Enrichment imports skip them, the storefront hides any that were stored before, and
 * `npm run enrichment:placeholders -- clean --apply` removes them from existing enrichments.
 *
 * Keyed by sha256 because media ids differ between machines (the storefront bundle remaps media by sha256).
 * An entry is added only after looking at the image (`enrichment:placeholders candidates` writes contact sheets).
 * Being shared by many part numbers is not enough: real product-family photos are shared too (a Dayco poly-V belt
 * photo by 197 parts, a Bosch belt photo by 6) and never belong here.
 *
 * Keep the list sorted by sha256.
 */
export type PlaceholderImage = { sha256: string; source: string; note: string };

// Reviewed from `enrichment:placeholders candidates --min-parts=5` contact sheets (#1098).
export const placeholderImages: readonly PlaceholderImage[] = [
  { sha256: "05456a6d103020e3599d78cc5b276549aa55b3be75666f4d2fa97a71f6df7296", source: "cdn.spareto.com", note: "Diesel Technic multilingual legal notice" },
  { sha256: "17f20c53b9db6cde101b39495fea7daa04e99b8e59ae364f790404552c181633", source: "picdn.trodo.com", note: "febi \"Image coming soon\" shock absorber drawing" },
  { sha256: "273496004745313788b76824eb5aae9f50f7429a7ed683d8d7633cf6b7f02111", source: "picdn.trodo.com", note: "NRF warning-sign pictogram" },
  { sha256: "30b74964e699265512efc2b49a5eb079c55269cfd4377b29e8180e148a54f55e", source: "picdn.trodo.com", note: "NRF HTG grease packet on sensors" },
  { sha256: "3fc16aaeab96be60402f070a00d06de7062f20e70d98d3c75851c457dab2adeb", source: "cdn.spareto.com", note: "SKV \"Photo coming soon\"" },
  { sha256: "4831e7d1c03cc4d4ab738c401d472a0742fcb64fc3bd3130d022685153ad4a66", source: "picdn.trodo.com", note: "NRF thermostat pictogram" },
  { sha256: "4b5984af896cc68a6ca16d1dbb933501ceb6f96ca4d7ce9fade8eeb523b660c1", source: "cdn.spareto.com", note: "Corteco/Elring generic cylinder head gasket set tile" },
  { sha256: "5d06d107c8531164f436a19a3d55df138846deb988f46c2d38637b02a05fe664", source: "parts2world.com", note: "Corteco \"Pictures may different from actual products\" drawing" },
  { sha256: "7fdfba9d547dae8e6aa488f953772ee5755599bc7449b449ca155a910071afdc", source: "parts2world.com", note: "ERA \"New packaging coming soon\" banner" },
  { sha256: "852a6128e04abdf2e7297a984bb5913e4f6950dc9769eaa9dc32c331d0e6c251", source: "cdn.spareto.com", note: "HELLA QR code" },
  { sha256: "96fbe3713833bee78bd3b4d44e223a259221e599135d97ed2abab02ba3914bc5", source: "picdn.trodo.com", note: "NRF QR code" },
  { sha256: "a095c35464dcfa344f0d5b9fcc23d4b4bb99da62e71976205ed105b59b525585", source: "parts2world.com", note: "MAHLE \"For illustration purpose only\" pictogram" },
  { sha256: "b523b7a898b6da33c4e7806d707dcb052901dc59ee6d1a453e439485ebf41ddd", source: "cdn.spareto.com", note: "SKV \"Photo coming soon\"" },
  { sha256: "b87f1086aa63ce731429e1a0bc99dfe3ee3abe1204b48847eb2f97e197e826a2", source: "cdn.spareto.com", note: "Diesel Technic multilingual legal notice" },
  { sha256: "be46284393f3fec387fa7f5bb4cfcf59ba021513a6418e6f2d1ea6305e77c93d", source: "picdn.trodo.com", note: "NRF turbocharger pictogram" },
  { sha256: "bf955b7313813ee12b1832d24be701c4caf83ec142c3c5ae0da1416f662f515e", source: "cdn.spareto.com", note: "Valeo \"With Original Branding\" tile" },
  { sha256: "cbb79ed62a2be966da4c7dc7a9c864feb2160a90a02f4e399567e1e4dac9a211", source: "picdn.trodo.com", note: "NRF sensor pictogram" },
  { sha256: "cda5f943d10bcc2d1b206ba0fc354521581f3fcd598fc2ffa3df7cf781734c93", source: "cdn.spareto.com", note: "SKV \"Photo coming soon\"" },
  { sha256: "ef2b82efef65e31c6d9e0d50590675021678566d97b1fc91412c984e2576f961", source: "cdn.spareto.com", note: "SKV \"Photo coming soon\"" },
];

export const placeholderImageSha256: ReadonlySet<string> = new Set(placeholderImages.map(image => image.sha256));

export function isPlaceholderImage(bytes: Uint8Array, denylist: ReadonlySet<string> = placeholderImageSha256): boolean {
  return denylist.size > 0 && denylist.has(createHash("sha256").update(bytes).digest("hex"));
}
