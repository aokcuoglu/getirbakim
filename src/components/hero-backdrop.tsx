const mobileMedia = "(max-width: 600px)";
const desktopMedia = "(min-width: 601px)";

/**
 * The darkened photo behind a storefront hero (#736): a real <img> instead of a CSS background, so the browser finds it in the
 * HTML (preloaded per viewport, high priority) and a phone fetches a small crop instead of the 3840px banner.
 * The parent is `relative` with the ink background (shown until the photo loads); its content children need `relative` to sit above it.
 */
export function HeroBackdrop({ mobile, desktop, desktop2x }: { mobile: string; desktop: string; desktop2x?: string }) {
  const srcSet = desktop2x ? `${desktop} 1920w, ${desktop2x} 3840w` : undefined;
  // <link> elements, not react-dom preload(): a Server Component's preload() travels as a Flight hint that never reached the
  // HTML head here; React hoists these into <head> with the rest of the shell.
  return <>
    <link rel="preload" as="image" href={mobile} media={mobileMedia} fetchPriority="high"/>
    <link rel="preload" as="image" href={desktop} imageSrcSet={srcSet} imageSizes={srcSet && "100vw"} media={desktopMedia} fetchPriority="high"/>
    <picture>
      <source media={mobileMedia} srcSet={mobile}/>
      {srcSet && <source srcSet={srcSet} sizes="100vw"/>}
      <img src={desktop} alt="" fetchPriority="high" className="absolute inset-0 size-full object-cover object-center"/>
    </picture>
    <div aria-hidden="true" className="absolute inset-0 bg-[#212b36cc]"/>
  </>;
}
