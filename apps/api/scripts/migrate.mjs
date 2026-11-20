import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const directory = new URL('../db/migrations/', import.meta.url);
const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(271801)');
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY)');
  const { rows } = await client.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map(({ name }) => name));
  for (const file of files) {
    if (applied.has(file)) continue;
    await client.query(await readFile(new URL(file, directory), 'utf8'));
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
  }
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
