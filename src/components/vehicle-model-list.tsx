import Link from "next/link";
import { getListedModelGroups } from "@/modules/store/catalog";
import { vehicleModelGroupFamilies, vehicleModelGroupYears } from "@/modules/store/vehicle-model-groups";
import { modelPath } from "@/modules/seo/paths";

// A make page's models (#639): each family with its generations, newest first, linking to the model pages. Only
// units that list a product are linked (the others' pages are 404).
export async function VehicleModelList({ brandId, makeName, makeSlug }: { brandId: string; makeName: string; makeSlug: string }) {
  const families = vehicleModelGroupFamilies(await getListedModelGroups(brandId));
  if (!families.length) return null;
  return <section className="mb-8 max-[768px]:mb-6" aria-labelledby="vehicle-models">
    <h2 id="vehicle-models" className="mb-[15px] text-xl leading-7 font-medium tracking-[-.4px]">{makeName} modelleri</h2>
    <div className="columns-4 gap-8 max-[992px]:columns-3 max-[768px]:columns-2 max-[420px]:columns-1">
      {families.map(family => <div key={family.family} className="mb-4 break-inside-avoid">
        <h3 className="mb-1 text-sm leading-5 font-semibold">{family.family}</h3>
        <ul className="text-[13px] leading-[18px]">{family.groups.map(group => {
          const years = vehicleModelGroupYears(group);
          return <li key={group.slug}><Link prefetch={false} className="inline-flex min-h-8 items-center gap-1.5 hover:text-primary hover:underline" href={modelPath(makeSlug, group.slug)}>
            {group.name}{years && <span className="text-muted-foreground">{years}</span>}
          </Link></li>;
        })}</ul>
      </div>)}
    </div>
  </section>;
}
