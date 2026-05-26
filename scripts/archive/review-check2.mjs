import { db } from '@/lib/db'
const rows = await db.$queryRaw`
  SELECT id, url_key, name, has_childs 
  FROM part_categories 
  WHERE url_key ILIKE '%air-filt%' OR url_key ILIKE '%hava%'
  LIMIT 10`
console.log(JSON.stringify(rows, null, 2))
