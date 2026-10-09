import {createServer} from 'node:http';
import {randomBytes,randomUUID,timingSafeEqual,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {Pool} from 'pg';
import {S3Client,PutObjectCommand,HeadObjectCommand} from '@aws-sdk/client-s3';
import sharp from 'sharp';
import {transform} from 'esbuild';
const pool=new Pool({connectionString:process.env.DATABASE_URL});
await pool.query(await readFile('db/source-categories.sql','utf8'));
await pool.query(`INSERT INTO category_image_jobs(source,category_id,path)
 SELECT source,category_id,'/media/catalog/category_m2/270/'||(raw->>'d') FROM source_categories
 WHERE source='trodo' AND raw->>'d' ~ '^[a-zA-Z0-9_.-]+\\.(jpg|jpeg|png)$' ON CONFLICT DO NOTHING`);
if(process.argv[2]==='status'){console.log((await pool.query('SELECT status,count(*)::int FROM category_image_jobs GROUP BY status')).rows);await pool.end();}
else{
 const owner=await pool.connect();if(!(await owner.query('SELECT pg_try_advisory_lock(20261007,3) AS locked')).rows[0].locked)throw Error('Category image worker already running');
 const token=randomBytes(32).toString('hex'),bridge='http://127.0.0.1:4319';
 const code=await transform((await readFile('scripts/category-image-browser.js','utf8'))+`\nvoid categoryImageCollector(${JSON.stringify(bridge)},${JSON.stringify(token)});`,{minify:true,target:'es2022'});
 await mkdir('.local/enrichment',{recursive:true});await writeFile('.local/enrichment/category-image-start.js',code.code,{mode:0o600});
 const storage=new S3Client({endpoint:process.env.S3_ENDPOINT,region:process.env.S3_REGION||'us-east-1',forcePathStyle:true,credentials:{accessKeyId:process.env.S3_ACCESS_KEY_ID!,secretAccessKey:process.env.S3_SECRET_ACCESS_KEY!}});
 let stopped=false,nextClaim=0;
 const server=createServer(async(req,res)=>{
  if(req.headers.origin!=='https://www.trodo.com'){res.writeHead(403).end();return;}
  res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  if(req.method==='OPTIONS'){res.writeHead(204).end();return;}
  const got=Buffer.from(String(req.headers.authorization??'')),wanted=Buffer.from('Bearer '+token);if(got.length!==wanted.length||!timingSafeEqual(got,wanted)){res.writeHead(401).end();return;}
  const client=await pool.connect();try{
   let result:unknown;
   if(req.method==='GET'&&req.url==='/claim'){
    const blocked=(await client.query("SELECT 1 FROM category_image_jobs WHERE status='blocked' LIMIT 1")).rowCount;
    if(blocked)result={blocked:true};else if(Date.now()<nextClaim)result={waitMs:nextClaim-Date.now()};else{
     const lease=randomUUID();const row=(await client.query(`WITH picked AS(SELECT source,category_id FROM category_image_jobs WHERE status='queued' OR(status='leased' AND lease_until<now()) ORDER BY category_id FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE category_image_jobs j SET status='leased',lease_token=$1,lease_until=now()+interval '2 minutes',attempts=attempts+1,updated_at=now()
      FROM picked p WHERE j.source=p.source AND j.category_id=p.category_id RETURNING j.category_id AS id,j.path`,[lease])).rows[0];
     nextClaim=Date.now()+1000;result=row?{...row,token:lease}:(await client.query("SELECT 1 FROM category_image_jobs WHERE status='leased' LIMIT 1")).rowCount?{waitMs:1000}:{done:true};
    }
   }else if(req.method==='POST'&&req.url==='/result'){
    const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>7000000)throw Error('Result too large');chunks.push(chunk);}const data=JSON.parse(Buffer.concat(chunks).toString());
    await client.query('BEGIN');const job=(await client.query("SELECT * FROM category_image_jobs WHERE category_id=$1 AND source='trodo' AND lease_token=$2 AND status='leased' FOR UPDATE",[data.id,data.token])).rows[0];if(!job)throw Error('Stale category result');
    if(data.status!==200){const status=[401,403,429].includes(data.status)?'blocked':job.attempts>=3||data.status===404?'failed':'queued';await client.query("UPDATE category_image_jobs SET status=$2,last_error=$3,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE category_id=$1 AND source='trodo'",[data.id,status,'Source HTTP '+data.status]);}
    else{
     if(typeof data.data!=='string'||!/^data:image\/(jpeg|png|webp);base64,/.test(data.data))throw Error('Invalid image data');
     const bytes=await sharp(Buffer.from(data.data.split(',')[1],'base64'),{limitInputPixels:10000000}).resize({width:270,height:180,fit:'inside',withoutEnlargement:true}).webp({quality:90}).toBuffer();
     const info=await sharp(bytes).metadata(),hash=createHash('sha256').update(bytes).digest('hex'),key=`categories/${hash.slice(0,2)}/${hash}.webp`,bucket=process.env.S3_BUCKET!;
     await storage.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:bytes,ContentType:'image/webp',Metadata:{sha256:hash}}));const head=await storage.send(new HeadObjectCommand({Bucket:bucket,Key:key}));if(head.ContentLength!==bytes.length||head.Metadata?.sha256!==hash)throw Error('Category object verification failed');
     const media=(await client.query(`INSERT INTO product_media_objects(bucket,object_key,sha256,content_type,size_bytes,source_url) VALUES($1,$2,$3,'image/webp',$4,$5)
      ON CONFLICT(sha256) DO UPDATE SET sha256=EXCLUDED.sha256 RETURNING id`,[bucket,key,hash,bytes.length,'https://www.trodo.com'+job.path])).rows[0];
     await client.query(`INSERT INTO source_category_images(source,category_id,media_id,width,height) VALUES('trodo',$1,$2,$3,$4)
      ON CONFLICT(source,category_id) DO UPDATE SET media_id=EXCLUDED.media_id,width=EXCLUDED.width,height=EXCLUDED.height`,[data.id,media.id,info.width,info.height]);
     await client.query("UPDATE category_image_jobs SET status='complete',lease_token=NULL,lease_until=NULL,last_error=NULL,updated_at=now() WHERE source='trodo' AND category_id=$1",[data.id]);
    }
    await client.query('COMMIT');result={saved:true};
   }else{res.writeHead(404).end();return;}
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
  }catch(e){await client.query('ROLLBACK');console.error('Category image',e instanceof Error?e.message:'unknown');res.writeHead(400).end(JSON.stringify({error:e instanceof Error?e.message:'unknown'}));}finally{client.release();}
 });
 await new Promise<void>(r=>server.listen(4319,'127.0.0.1',r));console.log('Category image bridge ready; .local/enrichment/category-image-start.js');
 for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{stopped=true;});
 while(!stopped){const remaining=(await pool.query("SELECT count(*)::int AS count FROM category_image_jobs WHERE status IN ('queued','leased')")).rows[0].count;if(!remaining)break;await new Promise(r=>setTimeout(r,2000));}
 await new Promise<void>(r=>server.close(()=>r()));await owner.query('SELECT pg_advisory_unlock(20261007,3)');owner.release();await pool.end();
}
