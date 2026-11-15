import {readFile} from "node:fs/promises";
import sharp from "sharp";
import {z} from "zod";
import {db} from "../src/lib/db";
import {objectStorage} from "../src/lib/object-storage";
import {storeProductImageBytes} from "../src/modules/enrichment/import";

const entries=z.array(z.object({categoryId:z.number().int().positive(),imageFile:z.string().min(1),imageSource:z.url()})).min(1).max(100).parse(JSON.parse(await readFile(process.argv[2],"utf8")));
const storage=objectStorage();
try {
  for(const entry of entries){
    const row=(await db.query<{filename:string}>("SELECT raw->>'d' AS filename FROM source_categories WHERE source='trodo' AND category_id=$1",[entry.categoryId])).rows[0];
    const url=new URL(entry.imageSource);
    if(!row?.filename||!['picdn.trodo.com','www.trodo.com'].includes(url.hostname)||url.protocol!=="https:"||url.port||url.username||url.password||url.search||url.hash||![135,270,405].some(width=>url.pathname===`/media/catalog/category_m2/${width}/${row.filename}`))throw Error("Category image source does not match the recorded category");
    const source=await readFile(entry.imageFile);
    if(source.length>7000000)throw Error("Category image is too large");
    const bytes=await sharp(source,{limitInputPixels:10000000}).resize({width:270,height:180,fit:"inside",withoutEnlargement:true}).webp({quality:90}).toBuffer();
    const dimensions=await sharp(bytes).metadata();
    const client=await db.connect();
    try {
      await client.query("BEGIN");
      // categories/<hash[0:2]>/<hash>.webp in S3_BUCKET, verified, with the row's stored_at refreshed for npm run media:gc.
      const mediaId=await storeProductImageBytes(client,bytes,url.href,storage,"categories");
      await client.query(`INSERT INTO source_category_images(source,category_id,media_id,width,height) VALUES('trodo',$1,$2,$3,$4)
        ON CONFLICT(source,category_id) DO UPDATE SET media_id=EXCLUDED.media_id,width=EXCLUDED.width,height=EXCLUDED.height`,[entry.categoryId,mediaId,dimensions.width,dimensions.height]);
      await client.query("UPDATE category_image_jobs SET status='complete',last_error=NULL,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE source='trodo' AND category_id=$1",[entry.categoryId]);
      await client.query("COMMIT");
      console.log(JSON.stringify({categoryId:entry.categoryId,width:dimensions.width,height:dimensions.height,saved:true}));
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }
}finally{await db.end();}
