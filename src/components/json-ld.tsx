import { serializeJsonLd, type JsonLdNode } from "@/modules/seo/structured-data";

export function JsonLd({ data }: { data: JsonLdNode | null | undefined }) {
  if (!data) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}/>;
}
