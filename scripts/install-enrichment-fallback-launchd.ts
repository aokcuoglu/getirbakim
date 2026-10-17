import { spawnSync } from "node:child_process";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
// Runs scripts/enrichment-fallback.ts every hour: otoparcasan.com and spareto.com search the products the Trodo
// worker could not find. launchd never starts a second copy while a pass is still running.
if (process.platform !== "darwin") throw new Error("This installer requires macOS.");
const root = resolve(import.meta.dirname, "..");
const label = "com.getirbakim.enrichment-fallback";
const path = resolve(homedir(), "Library/LaunchAgents", `${label}.plist`);
const uid = process.getuid!();
const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
spawnSync("launchctl", ["bootout", `gui/${uid}/${label}`], { stdio: "ignore" });
if (process.argv.includes("--uninstall")) { await unlink(path).catch(() => {}); console.log(`${label} removed.`); process.exit(0); }
const logs = resolve(root, ".local/enrichment-fallback");
await mkdir(logs, { recursive: true });
await mkdir(resolve(homedir(), "Library/LaunchAgents"), { recursive: true });
const args = [process.execPath, `--env-file=${root}/.env.local`, "--import", "tsx", `${root}/scripts/enrichment-fallback.ts`];
await writeFile(path, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${args.map(arg => `<string>${escape(arg)}</string>`).join("")}</array>
<key>WorkingDirectory</key><string>${escape(root)}</string>
<key>StartInterval</key><integer>3600</integer>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin</string></dict>
<key>StandardOutPath</key><string>${escape(logs)}/fallback.log</string>
<key>StandardErrorPath</key><string>${escape(logs)}/fallback.log</string>
<key>ProcessType</key><string>Background</string>
</dict></plist>`, { mode: 0o600 });
const result = spawnSync("launchctl", ["bootstrap", `gui/${uid}`, path], { encoding: "utf8" });
if (result.status !== 0) throw new Error(`Could not register ${label}: ${result.stderr}`);
console.log(`${label} installed: every hour; log: .local/enrichment-fallback/fallback.log`);
