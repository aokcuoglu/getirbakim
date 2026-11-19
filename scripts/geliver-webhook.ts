import { createWebhook, deleteWebhook, geliverConfig, listWebhooks, testWebhook, type GeliverConfig, type GeliverResult } from "../src/modules/shipping/geliver";

// Geliver TRACK_UPDATED webhook registration (#960); see docs/commerce.md "Geliver ile kargo etiketi".
//   npm run geliver:webhook -- list
//   npm run geliver:webhook -- register --url=https://getirbakim.com [--header-only]
//   npm run geliver:webhook -- test --url=https://getirbakim.com
//   npm run geliver:webhook -- delete --id=<webhook id>
// The secret travels in the X-Geliver-Secret header and (unless --header-only) the `token` query parameter, since
// Geliver documents no webhook header. Tokens and secrets are masked in the output.

const PATH = "/api/shipping/geliver/webhook";
const [command, ...rest] = process.argv.slice(2);
const option = (name: string) => rest.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => rest.includes(`--${name}`);

const mask = (url: string) => url.replace(/([?&]token=)[^&]*/g, "$1***");
const fail = (message: string): never => { console.error(message); process.exit(1); };

function unwrap<T>(result: GeliverResult<T>): T {
  if (result.kind === "ok") return result.data;
  return fail(result.kind === "rejected" ? `Geliver refused (${result.code}): ${result.message}` : `No usable Geliver reply: ${result.reason}`);
}

function origin(raw: string | undefined) {
  if (!raw) return fail("--url=https://<domain> is required.");
  const url = new URL(raw);
  if (url.protocol !== "https:") fail("The webhook URL must be https.");
  return url.origin;
}

function secret() {
  const value = process.env.GELIVER_WEBHOOK_SECRET ?? "";
  return value.length >= 32 ? value : fail("GELIVER_WEBHOOK_SECRET must be set (at least 32 random characters).");
}

async function list(config: GeliverConfig) {
  const hooks = unwrap(await listWebhooks(config));
  if (!hooks.length) console.log("No webhooks registered.");
  for (const hook of hooks) {
    console.log(`${hook.id}  ${hook.type}  ${mask(hook.url)}  active=${hook.isActive ?? "?"}  header=${hook.headerName || "-"}${hook.headerValue ? " (value set)" : ""}`);
  }
}

async function register(config: GeliverConfig) {
  const base = `${origin(option("url"))}${PATH}`;
  const value = secret();
  const url = flag("header-only") ? base : `${base}?${new URLSearchParams({ token: value })}`;
  const existing = unwrap(await listWebhooks(config)).find(hook => hook.type === "TRACK_UPDATED" && hook.url === url);
  if (existing) { console.log(`Already registered: ${existing.id} ${mask(existing.url)}`); return; }
  const hook = unwrap(await createWebhook(config, { url, headerName: "X-Geliver-Secret", headerValue: value }));
  console.log(`Registered ${hook.id} ${hook.type} ${mask(hook.url)}`);
  console.log(hook.headerName === "X-Geliver-Secret"
    ? "Geliver kept the X-Geliver-Secret header."
    : "Geliver did not echo the X-Geliver-Secret header; the token query parameter authenticates the webhook.");
}

async function test(config: GeliverConfig) {
  const url = `${origin(option("url"))}${PATH}?${new URLSearchParams({ token: secret() })}`;
  unwrap(await testWebhook(config, url));
  console.log(`Geliver sent a sample TRACK_UPDATED to ${mask(url)}; it is acknowledged and ignored (unknown shipment).`);
}

async function remove(config: GeliverConfig) {
  const id = option("id") ?? fail("--id=<webhook id> is required.");
  unwrap(await deleteWebhook(config, id));
  console.log(`Deleted ${id}.`);
}

const config = geliverConfig() ?? fail("GELIVER_API_TOKEN is not set.");
const commands: Record<string, (config: GeliverConfig) => Promise<void>> = { list, register, test, delete: remove };
const run = commands[command ?? ""] ?? fail("Usage: geliver:webhook list | register --url=https://<domain> [--header-only] | test --url=https://<domain> | delete --id=<id>");
await run(config);
