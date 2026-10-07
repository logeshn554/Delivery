import {Pool} from 'pg';
import {readdir, readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL for PostgreSQL before running migrations.');
const pool = new Pool({connectionString:process.env.DATABASE_URL, max:1});
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(708413920)');
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied timestamptz NOT NULL DEFAULT now())');
  const directory = new URL('./migrations/', import.meta.url);
  for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(name, directory),'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const {rows} = await client.query('SELECT checksum FROM schema_migrations WHERE name=$1',[name]);
    if (rows.length) {if(rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${name}`); continue;}
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,checksum]);
    console.log(`Applied ${name}`);
  }
  await client.query('COMMIT');
} catch(error) {await client.query('ROLLBACK'); throw error;}
finally {client.release(); await pool.end();}
