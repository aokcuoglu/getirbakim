import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Wrench } from "lucide-react";

/** Home carousel's first card: an ad-style banner for /bakim-robotu, sized like the photo promotions next to it. */
export function MaintenanceRobotBanner() {
  return <Link href="/bakim-robotu" aria-label="Bakım Robotu: aracına özel bakım setini kur"
    className="group relative grid h-[292px] grid-cols-[minmax(0,1fr)_236px] items-center gap-4 overflow-hidden rounded-md bg-[linear-gradient(118deg,#0a2540_0%,#0b4a85_55%,#0077c7_100%)] pr-7 pl-8 text-white max-[1100px]:grid-cols-[minmax(0,1fr)_190px] max-md:h-[250px] max-md:grid-cols-[minmax(0,1fr)_128px] max-md:gap-3 max-md:pr-4 max-md:pl-5">
    <span aria-hidden="true" className="pointer-events-none absolute -top-24 -right-16 size-[340px] rounded-full bg-white/[.07]"/>
    <span aria-hidden="true" className="pointer-events-none absolute -bottom-32 left-[38%] size-[260px] rounded-full bg-[#4fb3ff]/[.12]"/>
    <div className="relative z-[1] min-w-0">
      <p className="mb-3 flex items-center gap-2 max-md:mb-2">
        <span className="rounded-[2px] bg-[#c94037] px-2 py-1 text-[11px] leading-4 font-bold tracking-[.6px]">YENİ</span>
        <span className="inline-flex items-center gap-1.5 text-[13px] leading-5 font-semibold tracking-[.8px] text-[#9fd3ff] max-md:text-xs"><Wrench size={15} aria-hidden="true"/>BAKIM ROBOTU</span>
      </p>
      <h2 className="mb-2 text-[27px] text-balance leading-[33px] font-semibold tracking-[-.6px] max-[1100px]:text-[23px] max-[1100px]:leading-[29px] max-md:mb-1.5 max-md:text-xl max-md:leading-[25px]">Bakım setini aracına göre kur</h2>
      <p className="mb-5 max-w-[340px] text-sm leading-5 text-white/85 max-md:mb-3 max-md:text-[13px] max-md:leading-[18px]">3&apos;lü, 4&apos;lü veya 5&apos;li filtre ve motor yağı setini markalarını seçerek tek seferde sepete ekle.</p>
      <span className="inline-flex h-11 items-center gap-2 rounded-md bg-white px-5 text-sm font-semibold text-[#0b4a85] shadow-[0_6px_18px_#0a254040] transition-colors group-hover:bg-[#eef7fd] max-md:h-10 max-md:px-4 max-md:text-[13px]">Setini kur<ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true"/></span>
    </div>
    <div className="relative z-[1] rotate-[3deg] overflow-hidden rounded-lg bg-white p-1.5 shadow-[0_18px_40px_#0a254066] transition-transform duration-300 group-hover:rotate-[1deg] max-md:rounded-md max-md:p-1">
      <Image src="/media/site/images/bakim-robotu-set.webp" width={720} height={666} alt="" unoptimized className="h-auto w-full rounded-[5px]"/>
    </div>
  </Link>;
}
