const mobileMedia = "(max-width: 599.98px)";
const desktopMedia = "(min-width: 600px)";

/** A static image import (`StaticImageData` fits): the `src` is content-hashed under /_next/static/media. */
type HeroImage = { src: string; width: number; height: number };

type Props = {
  /** The image (1920w when `desktop2x` is given). */
  desktop: HeroImage;
  /** A centre crop for phones; without it every viewport uses `desktop`. */
  mobile?: HeroImage;
  /** A 3840w version for wide and high-density screens. */
  desktop2x?: HeroImage;
  /** The 80% ink layer the photo heroes use; off for images that are already dark. */
  overlay?: boolean;
};

/**
 * The photo behind a storefront hero (#736): a real <img> instead of a CSS background, so the browser finds it in the
 * HTML (preloaded per viewport, high priority) and a phone fetches a small crop instead of the 3840px banner.
 * The parent is `relative` with the ink background (shown until the photo loads); its content children need `relative` to sit above it.
 * Callers pass static imports (#1217): the URL is content-hashed under /_next/static/media (plus the per-release ?dpl suffix
 * in production), so a CDN can cache it immutably and a changed file never serves stale bytes under the old URL; browsers
 * re-download it once per release. Preload hrefs and <source> srcSets are built from the same `src` strings.
 */
export function HeroBackdrop({ desktop, mobile, desktop2x, overlay = true }: Props) {
  const srcSet = desktop2x ? `${desktop.src} 1920w, ${desktop2x.src} 3840w` : undefined;
  // <link> elements, not react-dom preload(): a Server Component's preload() travels as a Flight hint that never reached the
  // HTML head here; React hoists these into <head> with the rest of the shell.
  return <>
    {mobile && <link rel="preload" as="image" href={mobile.src} media={mobileMedia} fetchPriority="high"/>}
    <link rel="preload" as="image" href={desktop.src} imageSrcSet={srcSet} imageSizes={srcSet && "100vw"} media={mobile && desktopMedia} fetchPriority="high"/>
    <picture>
      {mobile && <source media={mobileMedia} srcSet={mobile.src} width={mobile.width} height={mobile.height}/>}
      {srcSet && <source srcSet={srcSet} sizes="100vw" width={desktop.width} height={desktop.height}/>}
      <img src={desktop.src} width={desktop.width} height={desktop.height} alt="" fetchPriority="high" className="absolute inset-0 size-full object-cover object-center"/>
    </picture>
    {overlay && <div aria-hidden="true" className="absolute inset-0 bg-[#212b36cc]"/>}
  </>;
}
