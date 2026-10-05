import { spawnSync } from "node:child_process";
import { mkdir,writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
if (process.platform!=="darwin") throw new Error("This installer requires macOS; use deploy/*.timer on Linux.");
const root=resolve(import.meta.dirname,"..");
const directory=resolve(homedir(),"Library/LaunchAgents");
await mkdir(directory,{recursive:true});
const escape=(s:string)=>s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const uid=process.getuid!();
const remove=process.argv.includes("--uninstall");
for (const [label,monitor] of [["com.getirbakim.supplier-sync",false],["com.getirbakim.supplier-monitor",true]] as const) {
  const path=resolve(directory,`${label}.plist`);
  spawnSync("launchctl",["bootout",`gui/${uid}/${label}`],{stdio:"ignore"});
  if (remove) { const {unlink}=await import("node:fs/promises"); await unlink(path).catch(()=>{}); continue; }
  const args=[process.execPath,`--env-file=${root}/.env.local`,"--import","tsx",`${root}/scripts/supplier-background.ts`,...(monitor ? ["--monitor"] : [])];
  await writeFile(path,`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${args.map(arg=>`<string>${escape(arg)}</string>`).join("")}</array>
<key>WorkingDirectory</key><string>${escape(root)}</string>
<key>StartInterval</key><integer>900</integer>
<key>RunAtLoad</key><${monitor ? "false" : "true"}/>
<key>ProcessType</key><string>Background</string>
</dict></plist>`,{mode:0o600});
  const result=spawnSync("launchctl",["bootstrap",`gui/${uid}`,path],{encoding:"utf8"});
  if(result.status!==0) throw new Error(`Could not register ${label}: ${result.stderr}`);
  console.log(`${label} installed: every 15 minutes${monitor ? "; local notifications on unhealthy status" : "; due groups only"}.`);
}
