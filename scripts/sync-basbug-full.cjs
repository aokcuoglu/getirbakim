/**
 * Başbuğ full sync script — tüm 15 ListeGrubu için MalzemeleriGetir + DB batch insert
 * Usage: node --require dotenv/config scripts/sync-basbug-full.js
 */
const { Pool } = require('pg')
const BASE = 'https://api.basbug.com.tr'
const FIRMA = 'BASBUG'
const CONCURRENCY = 2
const BATCH_SIZE = 1000

async function getToken() {
  const loginResp = await fetch(`${BASE}/auth/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kullaniciAdi: process.env.BASBUG_USERNAME,
      parola: process.env.BASBUG_PASSWORD,
      clientSecret: process.env.BASBUG_CLIENT_SECRET,
      clientId: process.env.BASBUG_CLIENT_ID
    }),
    signal: AbortSignal.timeout(15000)
  })
  if (!loginResp.ok) throw new Error(`Login failed: ${loginResp.status}`)
  const { token } = await loginResp.json()
  return token
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    max: 8,
    connectionTimeoutMillis: 15000
  })

  console.log('1/4 Logging in...')
  let token = await getToken()
  let tokenAt = Date.now()
  console.log('   Token OK')

  async function ensureToken() {
    if (Date.now() - tokenAt > 240_000) {
      token = await getToken()
      tokenAt = Date.now()
    }
  }

  async function apiFetch(path, retry = true) {
    await ensureToken()
    const resp = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(120000)
    })
    if (resp.status === 401 && retry) {
      token = await getToken()
      tokenAt = Date.now()
      return apiFetch(path, false)
    }
    return resp
  }

  console.log('2/4 Fetching group list...')
  const groupsResp = await apiFetch(`/material/ListeGrubuGetir?FirmaAdi=${FIRMA}`)
  if (!groupsResp.ok) throw new Error(`ListeGrubuGetir failed: ${groupsResp.status}`)
  const { malzemeGruplariListesi: groups } = await groupsResp.json()
  console.log(`   ${groups.length} groups found`)

  let totalProducts = 0
  let totalInserted = 0
  const startTime = Date.now()

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi]
    const groupStart = Date.now()
    console.log(`\n3/4 [${gi + 1}/${groups.length}] Fetching ${group.kod} (${group.ad})...`)

    const productsResp = await apiFetch(
      `/material/MalzemeleriGetir?FirmaAdi=${FIRMA}&ListeGrubu=${encodeURIComponent(group.kod)}`
    )
    if (!productsResp.ok) {
      console.log(`   ✗ HTTP ${productsResp.status}, skipping.`)
      continue
    }
    const { malzemeListesi: products } = await productsResp.json()
    console.log(`   Fetched ${products.length.toLocaleString()} products (${((Date.now() - groupStart) / 1000).toFixed(1)}s)`)

    if (!products.length) continue

    // Collect distinct brands
    const brandNames = [...new Set(products.map(p => (p.uk || '').trim()).filter(Boolean))]
    if (!brandNames.length) brandNames.push('BİLİNMEYEN')

    // Upsert brands
    console.log(`   Upserting ${brandNames.length} brands...`)
    for (const brand of brandNames) {
      await pool.query(
        `INSERT INTO v0.bsbg_brands (brand) VALUES ($1) ON CONFLICT (brand) DO UPDATE SET last_seen_at = NOW()`,
        [brand]
      )
    }

    // Resolve brand IDs
    const brandRows = await pool.query(`SELECT id, brand FROM v0.bsbg_brands WHERE brand = ANY($1)`, [brandNames])
    const brandMap = new Map(brandRows.rows.map(r => [r.brand, r.id]))

    // Batch insert products
    let inserted = 0
    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      const batch = products.slice(i, i + BATCH_SIZE)
      const now = new Date()

      const deduped = new Map()
      for (const p of batch) {
        const brandName = (p.uk || '').trim() || 'BİLİNMEYEN'
        const brandId = brandMap.get(brandName)
        const key = `${brandId}::${p.no}`
        if (!deduped.has(key)) deduped.set(key, { p, brandId })
      }

      const values = []
      const params = []
      let paramIdx = 1

      for (const { p, brandId } of deduped.values()) {
        const dc = (p.dc || '').toUpperCase() === 'TL' ? 'TRY' : (p.dc || '').toUpperCase()

        values.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8}, $${paramIdx + 9}, $${paramIdx + 10}, $${paramIdx + 11}, $${paramIdx + 12}::jsonb, $${paramIdx + 13})`)
        params.push(brandId, p.no, p.ac || null, p.ac2 || null, p.oe || null,
          p.lgk || group.kod, p.m || null, p.mo || null, p.y || null, p.b || null,
          dc, parseFloat(p.lf) || null, JSON.stringify(p), now)
        paramIdx += 14
      }

      await pool.query(
        `INSERT INTO v0.bsbg_products (bsbg_brands_id, malzeme_no, aciklama, aciklama2, oem_no, liste_grubu_kodu, arac_bilgisi, motor_bilgisi, yil_araligi, birim, para_birimi, liste_fiyati, raw, last_seen_at)
         VALUES ${values.join(', ')}
         ON CONFLICT (bsbg_brands_id, malzeme_no) DO UPDATE SET
           aciklama = EXCLUDED.aciklama, aciklama2 = EXCLUDED.aciklama2, oem_no = EXCLUDED.oem_no,
           liste_grubu_kodu = EXCLUDED.liste_grubu_kodu, arac_bilgisi = EXCLUDED.arac_bilgisi,
           motor_bilgisi = EXCLUDED.motor_bilgisi, yil_araligi = EXCLUDED.yil_araligi,
           birim = EXCLUDED.birim, para_birimi = EXCLUDED.para_birimi, liste_fiyati = EXCLUDED.liste_fiyati,
           raw = EXCLUDED.raw, last_seen_at = EXCLUDED.last_seen_at, is_passive = false`,
        params
      )
      inserted += batch.length
    }

    totalProducts += products.length
    totalInserted += inserted
    const elapsed = ((Date.now() - groupStart) / 1000).toFixed(1)
    console.log(`   ✓ ${inserted.toLocaleString()} inserted (${elapsed}s) | total: ${totalInserted.toLocaleString()}`)
  }

  const totalElapsed = ((Date.now() - startTime) / 60000).toFixed(1)
  console.log(`\n4/4 DONE! ${totalInserted.toLocaleString()} products in ${totalElapsed}min`)
  await pool.end()
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
