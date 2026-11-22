import { getListedModelGroups } from "@/modules/store/catalog";
import { getMotorcycleModelIds } from "@/modules/store/vehicle-model-groups.server";
import { vehicleModelGroupFamilies, vehicleModelGroupYears, vehicleModelLabels, type VehicleModelGroup } from "@/modules/store/vehicle-model-groups";
import { readableProductName } from "@/modules/store/product-name";
import { VehicleModelListView, type VehicleModelSection } from "./vehicle-model-list-view";

// A make page's models (#639): each family with its generations, newest first, linking to the model pages. Only
// units that list a product are linked (the others' pages are 404). Units whose every series is a two-wheeler (REPXPERT
// body type, #674) are listed in a section of their own below the cars. The labels are built here and the list is
// rendered by a client view from compact props (#1212), so its markup is not sent twice.
export async function VehicleModelList({ brandId, makeName, makeSlug }: { brandId: string; makeName: string; makeSlug: string }) {
  const [groups, motorcycles] = await Promise.all([getListedModelGroups(brandId), getMotorcycleModelIds(brandId)]);
  const isMotorcycle = (group: VehicleModelGroup) => group.models.every(series => motorcycles.has(series.id));
  const sections: VehicleModelSection[] = [
    { id: "vehicle-models", title: `${makeName} modelleri`, groups: groups.filter(group => !isMotorcycle(group)) },
    { id: "motorcycle-models", title: `${makeName} motosiklet modelleri`, groups: groups.filter(isMotorcycle) },
  ].filter(section => section.groups.length).map(({ id, title, groups }) => ({
    id, title,
    families: vehicleModelGroupFamilies(groups).map(family => [readableProductName(family.family),
      family.groups.map(group => [group.slug, vehicleModelLabels(makeName, group).model, vehicleModelGroupYears(group) ?? ""])]),
  }));
  return <VehicleModelListView makeSlug={makeSlug} sections={sections} />;
}
