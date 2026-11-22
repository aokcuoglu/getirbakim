"use client";
import Link from "next/link";
import { modelPath } from "@/modules/seo/paths";

/** A model family: its title and its units as [slug, label, years or ""]. */
export type VehicleModelFamily = [title: string, models: [slug: string, label: string, years: string][]];
export type VehicleModelSection = { id: string; title: string; families: VehicleModelFamily[] };

// Rendered on the server from compact props (#1212): a client view's markup goes out once as HTML, while a server
// component's goes out twice (HTML and the RSC payload), so the long model lists of a make page stay a client view.
export function VehicleModelListView({ makeSlug, sections }: { makeSlug: string; sections: VehicleModelSection[] }) {
  return sections.map(section => <section key={section.id} className="mb-8 max-[768px]:mb-6" aria-labelledby={section.id}>
    <h2 id={section.id} className="mb-[15px] text-xl leading-7 font-medium tracking-[-.4px]">{section.title}</h2>
    <div className="columns-4 gap-8 max-[992px]:columns-3 max-[768px]:columns-2 max-[420px]:columns-1">
      {/* A family's first unit slug is unique within the make (readable titles may coincide). */}
      {section.families.map(([title, models]) => <div key={models[0]?.[0] ?? title} className="model-family">
        <h3 className="model-family-title">{title}</h3>
        <ul className="model-family-list">{models.map(([slug, label, years]) => <li key={slug}><Link prefetch={false} className="model-link" href={modelPath(makeSlug, slug)}>
          {label}{years && <span>{years}</span>}
        </Link></li>)}</ul>
      </div>)}
    </div>
  </section>);
}
