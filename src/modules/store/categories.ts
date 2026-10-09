import 'server-only';
import {cache} from 'react';
import {connection} from 'next/server';
import {db} from '@/lib/db';
import type {StoreCategory} from './category-tree';
export const getStoreCategories=cache(async():Promise<StoreCategory[]>=>{
 // The shared header calls this; without it the build would prerender pages against the database.
 await connection();
 return (await db.query<StoreCategory>(`SELECT c.category_id AS id,c.parent_id AS "parentId",l.name,l.slug,c.path_ids AS path,
  CASE WHEN img.media_id IS NOT NULL THEN '/api/category-media/'||img.media_id::text END AS "imagePath",
  COALESCE((c.raw->>'l')::int,0) AS position FROM source_categories c JOIN source_category_labels l
  ON l.source=c.source AND l.category_id=c.category_id AND l.locale='tr'
  LEFT JOIN source_category_images img ON img.source=c.source AND img.category_id=c.category_id WHERE c.source='trodo'
  ORDER BY position,c.category_id`)).rows;
});
