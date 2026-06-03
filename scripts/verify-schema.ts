import { Client } from 'pg'

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres.fbhvayopjuixbyddftbk:cXnKHpGlPNkuc6oT@aws-1-ap-south-1.pooler.supabase.com:5432/postgres',
    ssl: { rejectUnauthorized: false }
  })
  await client.connect()

  // 1. Verify brand_list columns
  const brands = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'v0' AND table_name = 'brand_list'
    ORDER BY ordinal_position
  `)
  console.log('Canonical Brands Table:')
  brands.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type}`))

  // 2. Verify brand_mappings columns
  const maps = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'v0' AND table_name = 'brand_mappings'
    ORDER BY ordinal_position
  `)
  console.log('\nMappings Table:')
  maps.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type}`))

  // 3. AKSA sample
  const aksa = await client.query(`
    SELECT cb.id, cb.brand, cb.logo_url,
      m.id as map_id, m.dnmk_brands_id, m.ptdrk_brands_id, m.mapping_status, m.match_method,
      d.brand as dnmk_brand, pt.name as pt_name
    FROM v0.brand_list cb
    LEFT JOIN v0.brand_mappings m ON m.brand_list_id = cb.id
    LEFT JOIN v0.dnmk_brands d ON d.id = m.dnmk_brands_id
    LEFT JOIN v0.ptdrk_brands pt ON pt.id = m.ptdrk_brands_id
    WHERE cb.brand = 'AKSA'
  `)
  console.log('\nAKSA Sample:', JSON.stringify(aksa.rows, null, 2))

  // 4. Counts
  const counts = await client.query(`
    SELECT 
      (SELECT COUNT(*)::int FROM v0.brand_list) AS canonical_count,
      (SELECT COUNT(*)::int FROM v0.brand_mappings) AS mapping_count
  `)
  console.log('\nCounts:', counts.rows[0])

  // 5. Verify no duplicates in canonical
  const dupCheck = await client.query(`
    SELECT brand, COUNT(*)::int
    FROM v0.brand_list
    GROUP BY brand
    HAVING COUNT(*) > 1
  `)
  console.log('Duplicate canonical brands:', dupCheck.rows.length === 0 ? 'NONE ✓' : dupCheck.rows)

  await client.end()
}

main().catch(e => { console.error(e); process.exit(1) })
