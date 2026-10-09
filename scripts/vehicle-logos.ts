// Downloads vehicle make logos and registers them in data/brand-logos.json.
// Usage: node --import tsx scripts/vehicle-logos.ts path/to/sources.json
// sources.json maps a vehicle_brands display name to a logo URL (SVG, PNG or JPEG).
import {createHash} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import sharp from "sharp";
import {z} from "zod";
import {vehicleBrandSlug} from "../src/modules/store/vehicle-catalog";

const registryPath="data/brand-logos.json";
const sources=z.record(z.string().min(1),z.url()).parse(JSON.parse(await readFile(process.argv[2],"utf8")));
const registry=JSON.parse(await readFile(registryPath,"utf8")) as {vehicles:Record<string,unknown>};
const failures:string[]=[];
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
// Wikimedia rate-limits bursts: space requests out and honour Retry-After on 429.
async function download(url:string) {
  for(let attempt=0;attempt<6;attempt++) {
    await pause(3000);
    const response=await fetch(url,{headers:{"User-Agent":"getirbakim-logo-import/1.0 (https://getirbakim.com)"}});
    if(response.status===429) {await pause((Number(response.headers.get("retry-after"))||15)*1000);continue;}
    if(!response.ok) throw Error(`HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  throw Error("HTTP 429");
}

for(const [name,source] of Object.entries(sources)) {
  try {
    const input=await download(source);
    // Same treatment as the existing set: trim outer padding, fit into 320 × 144, keep colours and ratio.
    const {data,info}=await sharp(input,{density:300,limitInputPixels:false}).trim().resize({width:320,height:144,fit:"inside"})
      .webp({quality:90,alphaQuality:100}).toBuffer({resolveWithObject:true});
    const src=`/media/logos/vehicles/${vehicleBrandSlug(name)}.webp`;
    await writeFile("public"+src,data);
    registry.vehicles[name]={src,width:info.width,height:info.height,source,sha256:createHash("sha256").update(data).digest("hex")};
    console.log(`${name}: ${info.width}x${info.height}`);
  } catch(error) {failures.push(`${name}: ${(error as Error).message}`);}
}
await writeFile(registryPath,JSON.stringify(registry,null,2)+"\n");
if(failures.length) {console.error(failures.join("\n"));process.exitCode=1;}
