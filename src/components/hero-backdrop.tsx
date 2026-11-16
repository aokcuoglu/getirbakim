const mobileMedia = "(max-width: 600px)";
const desktopMedia = "(min-width: 601px)";

type Props = {
  /** The image (1920w when `desktop2x` is given). */
  desktop: string;
  /** A centre crop for phones; without it every viewport uses `desktop`. */
  mobile?: string;
  /** A 3840w version for wide and high-density screens. */
  desktop2x?: string;
  /** The 80% ink layer the photo heroes use; off for images that are already dark. */
  overlay?: boolean;
};

/**
 * The photo behind a storefront hero (#736): a real <img> instead of a CSS background, so the browser finds it in the
 * HTML (preloaded per viewport, high priority) and a phone fetches a small crop instead of the 3840px banner.
 * The parent is `relative` with the ink background (shown until the photo loads); its content children need `relative` to sit above it.
 */
export function HeroBackdrop({ desktop, mobile, desktop2x, overlay = true }: Props) {
  const srcSet = desktop2x ? `${desktop} 1920w, ${desktop2x} 3840w` : undefined;
  // <link> elements, not react-dom preload(): a Server Component's preload() travels as a Flight hint that never reached the
  // HTML head here; React hoists these into <head> with the rest of the shell.
  return <>
    {mobile && <link rel="preload" as="image" href={mobile} media={mobileMedia} fetchPriority="high"/>}
    <link rel="preload" as="image" href={desktop} imageSrcSet={srcSet} imageSizes={srcSet && "100vw"} media={mobile && desktopMedia} fetchPriority="high"/>
    <picture>
      {mobile && <source media={mobileMedia} srcSet={mobile}/>}
      {srcSet && <source srcSet={srcSet} sizes="100vw"/>}
      <img src={desktop} alt="" fetchPriority="high" className="absolute inset-0 size-full object-cover object-center"/>
    </picture>
    {overlay && <div aria-hidden="true" className="absolute inset-0 bg-[#212b36cc]"/>}
  </>;
}
