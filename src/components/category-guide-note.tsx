import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { guidePath, guidesPath, type Guide } from "@/content/guides";
import type { CategoryGuideNote as Note } from "@/content/category-guides";

export function CategoryGuideNote({ note, guides }: { note: Note; guides: Guide[] }) {
  return (
    <section aria-labelledby="kategori-rehberi" className="border-t border-border py-10 max-[768px]:py-8">
      <div className="mx-auto w-[calc(100%-30px)] max-w-[1320px]">
        <h2 id="kategori-rehberi" className="mb-3 text-[23px] leading-[29px] font-semibold tracking-[-.5px] max-[768px]:text-xl max-[768px]:leading-[26px]">{note.heading}</h2>
        <p className="max-w-[830px] text-sm leading-[22px] text-muted-foreground">{note.text}</p>
        {guides.length > 0 && <h3 className="mt-5 mb-3 text-base leading-6 font-semibold">İlgili rehber yazıları</h3>}
        <ul className={guides.length > 0 ? "flex flex-wrap gap-2" : "mt-5 flex flex-wrap gap-2"}>
          {guides.map(guide => <li key={guide.slug}><Link prefetch={false} href={guidePath(guide.slug)} className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 py-2 text-left text-sm hover:border-primary hover:text-primary">{guide.title}</Link></li>)}
          <li><Link href={guidesPath} className="inline-flex min-h-11 items-center gap-1 font-semibold text-primary hover:underline">Tüm rehber yazıları<ChevronRight size={16} aria-hidden="true" /></Link></li>
        </ul>
      </div>
    </section>
  );
}
