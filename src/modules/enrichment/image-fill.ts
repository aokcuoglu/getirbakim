import type {Pool} from 'pg';
import {storeProductImage} from './import';
import {completeWithImage,imageNote} from './partial-gaps';

export type ImageFillResult='complete'|'partial'|'skipped';
/** Attaches a photo another source verified for a partial product that has none. Only the image, its dimensions and
 *  the import note change; vehicles, OEM numbers and specifications stay as the data source wrote them. The job turns
 *  complete only when the image was its last gap. */
export async function attachProductImage(pool:Pool,image:{supplierItemId:string;file:string;source:string;width:number;height:number}):Promise<ImageFillResult>{
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  const current=(await db.query<{image_id:string|null;source_method:string}>('SELECT image_id,source_method FROM product_enrichments WHERE supplier_item_id=$1 FOR UPDATE',[image.supplierItemId])).rows[0];
  const job=(await db.query<{status:string}>('SELECT status FROM product_enrichment_jobs WHERE supplier_item_id=$1 FOR UPDATE',[image.supplierItemId])).rows[0];
  if(!current||current.image_id||job?.status!=='partial'){await db.query('ROLLBACK');return 'skipped';}
  const imageId=await storeProductImage(db,image.file,image.source);
  const note=imageNote(current.source_method,image.source);
  await db.query(`UPDATE product_enrichments SET image_id=$2,source_method=$3,payload=payload||jsonb_build_object('imageWidth',$4::int,'imageHeight',$5::int),imported_at=now()
   WHERE supplier_item_id=$1`,[image.supplierItemId,imageId,note,image.width,image.height]);
  const status=completeWithImage(note)?'complete':'partial';
  if(status==='complete')await db.query("UPDATE product_enrichment_jobs SET status='complete',last_error=NULL,updated_at=now() WHERE supplier_item_id=$1",[image.supplierItemId]);
  await db.query('COMMIT');
  return status;
 }catch(error){await db.query('ROLLBACK');throw error;}
 finally{db.release();}
}
