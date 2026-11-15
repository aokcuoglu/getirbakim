import sharp from "sharp";
import { readdir, writeFile } from "node:fs/promises";
for (const file of await readdir("public/brand")) {
  if (!file.endsWith(".svg")) continue;
  const size = file.startsWith("logo-") ? 920 : file === "profile.svg" ? 512 : 1080;
  await sharp(`public/brand/${file}`).resize({ width: size }).png().toFile(`public/brand/${file.replace('.svg', '.png')}`);
}
await sharp("public/brand/profile.svg").resize(32).png().toFile("public/brand/favicon-32.png");

// Browser and app icons: the multi-size favicon.ico (PNG payloads in an ICO container, sharp writes no ICO), the
// numbered Next icon, the opaque iOS touch icon and the manifest icons.
const profile = "public/brand/profile.svg";
const icoSizes = [16, 32, 48];
const icoImages = await Promise.all(icoSizes.map((size) => sharp(profile).resize(size, size).png().toBuffer()));
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoSizes.length, 4);
let offset = header.length + icoSizes.length * 16;
const entries = icoImages.map((image, index) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(icoSizes[index], 0);
  entry.writeUInt8(icoSizes[index], 1);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(image.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += image.length;
  return entry;
});
await writeFile("src/app/favicon.ico", Buffer.concat([header, ...entries, ...icoImages]));
await sharp(profile).resize(96, 96).png().toFile("src/app/icon1.png");
await sharp(profile).resize(180, 180).flatten({ background: "#0077c7" }).png().toFile("src/app/apple-icon.png");
await sharp(profile).resize(192, 192).png().toFile("public/brand/icon-192.png");
await sharp(profile).resize(512, 512).png().toFile("public/brand/icon-512.png");
console.log("Brand PNG exports generated.");
