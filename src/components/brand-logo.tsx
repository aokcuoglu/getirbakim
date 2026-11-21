import { cn } from "@/lib/utils";

/** `className` replaces the default widths (a named class carries its own), it is not merged with them. */
export function BrandLogo({ className }: { className?: string }) {
  // The same outlined wordmark is used in the header, footer and brand package.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={cn("block h-auto", className ?? "w-[180px] max-[600px]:w-[148px] max-[370px]:w-[120px]")} src="/brand/logo-light.svg" width="230" height="52" alt="getirbakim" />;
}
