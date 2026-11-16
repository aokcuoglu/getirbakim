import Link from "next/link";
import { getListedModelGroups } from "@/modules/store/catalog";
import { getMotorcycleModelIds } from "@/modules/store/vehicle-model-groups.server";
import { vehicleModelGroupFamilies, vehicleModelGroupYears, vehicleModelLabels, type VehicleModelGroup } from "@/modules/store/vehicle-model-groups";
import { readableProductName } from "@/modules/store/product-name";
import { modelPath } from "@/modules/seo/paths";

// A make page's models (#639): each family with its generations, newest first, linking to the model pages. Only
// units that list a product are linked (the others' pages are 404). Units whose every series is a two-wheeler (REPXPERT
// body type, #674) are listed in a section of their own below the cars.
export async function VehicleModelList({ brandId, makeName, makeSlug }: { brandId: string; makeName: string; makeSlug: string }) {
  const [groups, motorcycles] = await Promise.all([getListedModelGroups(brandId), getMotorcycleModelIds(brandId)]);
  const isMotorcycle = (group: VehicleModelGroup) => group.models.every(series => motorcycles.has(series.id));
  const sections = [
    { id: "vehicle-models", title: `${makeName} modelleri`, groups: groups.filter(group => !isMotorcycle(group)) },
    { id: "motorcycle-models", title: `${makeName} motosiklet modelleri`, groups: groups.filter(isMotorcycle) },
  ].filter(section => section.groups.length);
  return sections.map(section => <section key={section.id} className="mb-8 max-[768px]:mb-6" aria-labelledby={section.id}>
    <h2 id={section.id} className="mb-[15px] text-xl leading-7 font-medium tracking-[-.4px]">{section.title}</h2>
    <div className="columns-4 gap-8 max-[992px]:columns-3 max-[768px]:columns-2 max-[420px]:columns-1">
      {vehicleModelGroupFamilies(section.groups).map(family => <div key={family.family} className="mb-4 break-inside-avoid">
        <h3 className="mb-1 text-sm leading-5 font-semibold">{readableProductName(family.family)}</h3>
        <ul className="text-[13px] leading-[18px]">{family.groups.map(group => {
          const years = vehicleModelGroupYears(group);
          return <li key={group.slug}><Link prefetch={false} className="inline-flex min-h-8 items-center gap-1.5 hover:text-primary hover:underline" href={modelPath(makeSlug, group.slug)}>
            {vehicleModelLabels(makeName, group).model}{years && <span className="text-muted-foreground">{years}</span>}
          </Link></li>;
        })}</ul>
      </div>)}
    </div>
  </section>);
}
