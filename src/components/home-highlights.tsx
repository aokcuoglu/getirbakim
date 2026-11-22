import Image from "next/image";
import Link from "next/link";
import { RotateCcw, Search, Truck } from "lucide-react";
import { IntentLink } from "@/components/intent-link";
import { MaintenanceRobotBanner } from "@/components/maintenance-robot-banner";
import { homeFeatured, homeTrust, type HomeTrustIcon } from "@/content/home";
import { catalogPath, categoryPath } from "@/modules/seo/paths";

const icons: Record<HomeTrustIcon, typeof Search> = { search: Search, return: RotateCcw, truck: Truck };

/** Three policy-backed facts under the hero; phones show the titles only, one per row. */
export function HomeTrustLine() {
  return <div className="border-b border-border bg-white">
    <ul aria-label="Alışveriş bilgileri" className="mx-auto grid w-full max-w-[1350px] grid-cols-3 gap-4 px-[15px] max-md:grid-cols-1 max-md:gap-0">
      {homeTrust.map(({ icon, title, text, href }) => {
        const Icon = icons[icon];
        return <li key={icon}>
          <Link href={href} prefetch={false} className="flex min-h-11 items-center gap-3 py-4 text-foreground hover:text-primary max-md:py-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring">
            <Icon size={22} aria-hidden="true" className="shrink-0 text-primary"/>
            <span className="min-w-0"><strong className="block text-sm leading-5 font-medium">{title}</strong><span className="block text-[13px] leading-[18px] text-muted-foreground max-md:hidden">{text}</span></span>
          </Link>
        </li>;
      })}
    </ul>
  </div>;
}

type Category = { id: number; slug: string };

/** The banner plus two static category cards; no carousel. */
export function HomeFeaturedCards({ categories }: { categories: Category[] }) {
  return <section aria-label="Öne çıkanlar" className="grid grid-cols-2 gap-4 xl:grid-cols-[2fr_1fr_1fr]">
    <div className="col-span-2 min-w-0 xl:col-span-1"><MaintenanceRobotBanner/></div>
    {homeFeatured.map(card => {
      const category = categories.find(({ id }) => id === card.category);
      return <IntentLink key={card.image} href={category ? categoryPath(category.slug) : catalogPath} className="relative block h-[292px] min-w-0 overflow-hidden rounded-md bg-foreground text-white after:absolute after:inset-[65%_0_0] after:bg-[linear-gradient(transparent,#0008_30%,#000_90%)] max-md:h-40">
        <Image src={"/media/site/images/" + card.image} fill sizes="(max-width:768px) 50vw, (max-width:1279px) 50vw, 322px" alt="" unoptimized className="object-cover"/>
        <span className="absolute top-5 left-5 z-[1] rounded-[2px] bg-brand-strong px-2.5 py-1.5 text-sm leading-5 font-semibold text-white max-md:top-3 max-md:left-3 max-md:text-xs">{card.label}</span>
        <div className="absolute inset-x-0 bottom-5 z-[1] px-5 [text-shadow:1px_1px_2px_black] max-md:bottom-3 max-md:px-3"><h2 className="mb-1 text-xl leading-[26px] font-semibold tracking-[-.5px] max-md:text-base max-md:leading-5">{card.title}</h2><p className="text-sm leading-5 max-md:hidden">{card.description}</p></div>
      </IntentLink>;
    })}
  </section>;
}
