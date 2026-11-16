/**
 * Admin brand logos (#819): raw file size, accepted types and the box a logo is fitted into. Apart from sharp so the
 * logo form can read them in the browser.
 */
export const brandLogoLimits = { maxBytes: 1024 * 1024, maxWidth: 640, maxHeight: 288, minSide: 16 } as const;
export const brandLogoTypes = ["image/png", "image/svg+xml", "image/webp", "image/jpeg"] as const;
