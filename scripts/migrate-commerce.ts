import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
const pool = new Pool({connectionString:process.env.DATABASE_URL});
const client = await pool.connect();
try {
 await client.query('BEGIN');
 await client.query('SELECT pg_advisory_xact_lock(20261003,1)');
 await client.query(await readFile('db/commerce.sql','utf8'));
 await client.query('COMMIT');
 console.log('Commerce settings, carts, orders and TRY catalog ready.');
} catch(error) { await client.query('ROLLBACK'); throw error; }
finally { client.release(); await pool.end(); }
