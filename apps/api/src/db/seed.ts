import { readFile } from 'node:fs/promises';
import { pool } from './pool.ts';
try {
  const existing = await pool.query('SELECT count(*) FROM users');
  if (Number(existing.rows[0].count) > 0)
    console.log('Seed skipped: database already contains users.');
  else {
    await pool.query(await readFile(new URL('../../../../db/seed.sql', import.meta.url), 'utf8'));
    console.log('Demo data seeded.');
  }
} finally {
  await pool.end();
}
