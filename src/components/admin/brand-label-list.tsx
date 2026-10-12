import { TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";

export type BrandLabel = { label: string; items: string; method: string };

// Labels arrive largest first; showing them all made one brand (KRAFTVOLL, ~90 Dinamik labels) a screen tall.
const shown = 3;

function LabelBadge({ label }: { label: BrandLabel }) {
  return <Badge variant={label.method === "auto" ? "outline" : "secondary"} title={`${label.label} · ${label.items} kayıt · ${label.method === "auto" ? "otomatik" : "onaylı"}`}>
    {label.label}<span className="text-muted-foreground tabular-nums">{label.items}</span>
  </Badge>;
}

/** One supplier's labels of a master brand: the largest few, the rest behind "+N etiket". */
export function BrandLabelList({ brand, supplier, labels }: { brand: string; supplier: string; labels: BrandLabel[] }) {
  if (!labels.length) return <span className="text-muted-foreground">—</span>;
  const rest = labels.slice(shown);
  const hiddenAuto = rest.filter(label => label.method === "auto").length;
  return <div className="flex max-w-64 flex-wrap gap-1">
    {labels.slice(0, shown).map(label => <LabelBadge key={label.label} label={label}/>)}
    {rest.length > 0 && <Popover>
      <PopoverTrigger render={<Button variant="outline" size="xs" aria-label={`${brand} için ${supplier} etiketlerinin tümü (${labels.length})`}
        title={hiddenAuto ? `${hiddenAuto} otomatik etiket dahil` : undefined}/>}>
        {hiddenAuto > 0 && <TriangleAlert data-icon="inline-start" aria-hidden="true" className="text-warning"/>}+{rest.length} etiket
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <PopoverHeader>
          <PopoverTitle>{brand} · {supplier}</PopoverTitle>
          <PopoverDescription>{labels.length} etiket{hiddenAuto > 0 && `, ${labels.filter(label => label.method === "auto").length} otomatik`}</PopoverDescription>
        </PopoverHeader>
        <div className="flex max-h-72 flex-wrap gap-1 overflow-y-auto">{labels.map(label => <LabelBadge key={label.label} label={label}/>)}</div>
      </PopoverContent>
    </Popover>}
  </div>;
}
