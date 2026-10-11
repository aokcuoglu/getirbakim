import {cn} from "@/lib/utils";
import {socialProfiles} from "@/lib/site";

const profiles=[
  {name:"X",href:socialProfiles.x,path:"M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"},
  {name:"LinkedIn",href:socialProfiles.linkedin,path:"M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125zM7.119 20.452H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"},
];

/** The company's social profiles, shown as icon links in the footer. */
export function SocialLinks({className}:{className?:string}) {
  return <ul aria-label="Sosyal medya" className={cn("m-0 flex list-none items-center gap-3 p-0",className)}>
    {profiles.map(p=><li key={p.name}><a href={p.href} target="_blank" rel="noopener noreferrer" aria-label={`getirbakim ${p.name} hesabı`} title={p.name} className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-brand">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d={p.path}/></svg>
    </a></li>)}
  </ul>;
}
