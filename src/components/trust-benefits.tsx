import { Package, Search, BarChart3, ShieldCheck } from "lucide-react";
import { TRUST_BENEFITS } from "@/lib/storefront";

const ICON_MAP = {
  catalog: Package,
  search: Search,
  stock: BarChart3,
  shield: ShieldCheck,
} as const;

export function TrustBenefitRow() {
  return (
    <section className="bg-white border-b border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          {TRUST_BENEFITS.map((benefit) => {
            const Icon = ICON_MAP[benefit.icon as keyof typeof ICON_MAP];
            return (
              <div key={benefit.title} className="flex items-start gap-3 sm:gap-4">
                <div className="shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-accent/5 border border-accent/10 flex items-center justify-center">
                  {Icon && <Icon className="h-5 w-5 sm:h-6 sm:w-6 text-accent" />}
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm sm:text-base font-semibold text-foreground mb-1">
                    {benefit.title}
                  </h3>
                  <p className="text-xs sm:text-sm text-muted leading-relaxed">
                    {benefit.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}