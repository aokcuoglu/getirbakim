import { spawnSync } from "node:child_process";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
// Runs scripts/sync-storefront-production.ts every day at 04:30. A Mac asleep at that time runs it on wake.
if (process.platform !== "darwin") throw new Error("This installer requires macOS.");
const root = resolve(import.meta.dirname, "..");
const label = "com.getirbakim.storefront-sync";
const path = resolve(homedir(), "Library/LaunchAgents", `${label}.plist`);
const uid = process.getuid!();
const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
spawnSync("launchctl", ["bootout", `gui/${uid}/${label}`], { stdio: "ignore" });
if (process.argv.includes("--uninstall")) { await unlink(path).catch(() => {}); console.log(`${label} removed.`); process.exit(0); }
const logs = resolve(root, ".local/storefront-sync");
await mkdir(logs, { recursive: true });
await mkdir(resolve(homedir(), "Library/LaunchAgents"), { recursive: true });
const args = [process.execPath, `--env-file=${root}/.env.local`, "--import", "tsx", `${root}/scripts/sync-storefront-production.ts`];
await writeFile(path, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${args.map(arg => `<string>${escape(arg)}</string>`).join("")}</array>
<key>WorkingDirectory</key><string>${escape(root)}</string>
<key>StartCalendarInterval</key><dict><key>Hour</key><integer>4</integer><key>Minute</key><integer>30</integer></dict>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin</string></dict>
<key>StandardOutPath</key><string>${escape(logs)}/sync.log</string>
<key>StandardErrorPath</key><string>${escape(logs)}/sync.log</string>
<key>ProcessType</key><string>Background</string>
</dict></plist>`, { mode: 0o600 });
const result = spawnSync("launchctl", ["bootstrap", `gui/${uid}`, path], { encoding: "utf8" });
if (result.status !== 0) throw new Error(`Could not register ${label}: ${result.stderr}`);
console.log(`${label} installed: daily at 04:30; log: .local/storefront-sync/sync.log`);
