import sharp from "sharp";
import { readdir } from "node:fs/promises";
for (const file of await readdir("public/brand")) {
  if (!file.endsWith(".svg")) continue;
  const size = file.startsWith("logo-") ? 920 : file === "profile.svg" ? 512 : 1080;
  await sharp(`public/brand/${file}`).resize({ width: size }).png().toFile(`public/brand/${file.replace('.svg', '.png')}`);
}
await sharp("public/brand/profile.svg").resize(32).png().toFile("public/brand/favicon-32.png");
console.log("Brand PNG exports generated.");
