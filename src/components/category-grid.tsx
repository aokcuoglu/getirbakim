import Link from "next/link";
import {
  Disc3,
  Filter as FilterIcon,
  Cog,
  Lightbulb,
  ArrowDownUp,
  Zap,
  Thermometer,
  Droplets,
  Car,
  Sofa,
  CircleDot,
  Settings2,
} from "lucide-react";
import { CATEGORY_GRID } from "@/lib/storefront";

const ICON_MAP = {
  disc: Disc3,
  filter: FilterIcon,
  engine: Cog,
  light: Lightbulb,
  suspension: ArrowDownUp,
  electric: Zap,
  cooling: Thermometer,
  oil: Droplets,
  body: Car,
  interior: Sofa,
  tire: CircleDot,
  drivetrain: Settings2,
} as const;

export function CategoryGrid() {
  return (
    <section className="bg-surface">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 sm:py-16">
        <div className="text-center mb-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground">Kategorilere Göz At</h2>
          <p className="text-sm text-muted mt-2">İhtiyacınız olan parçayı kategori seçerek arayın</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 sm:gap-4">
          {CATEGORY_GRID.map((cat) => {
            const Icon = ICON_MAP[cat.icon as keyof typeof ICON_MAP];
            return (
              <Link
                key={cat.slug}
                href={cat.href}
                className="group flex flex-col items-center text-center p-4 sm:p-6 bg-white rounded-xl border border-border hover:border-accent/30 hover:shadow-md transition-all"
              >
                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-accent/5 border border-accent/10 flex items-center justify-center mb-3 group-hover:bg-accent/10 transition-colors">
                  {Icon && <Icon className="h-6 w-6 sm:h-7 sm:w-7 text-accent" />}
                </div>
                <h3 className="text-sm sm:text-base font-semibold text-foreground group-hover:text-accent transition-colors">
                  {cat.label}
                </h3>
                <p className="text-[11px] sm:text-xs text-muted mt-1 leading-snug">
                  {cat.description}
                </p>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}