import dotenv from 'dotenv';
import path from 'node:path';
import pg from 'pg';
dotenv.config({
  path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../../.env')],
  quiet: true,
});
export const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://taskbid:taskbid@localhost:5433/taskbid';
export const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 12,
  connectionTimeoutMillis: 5000,
});
pool.on('error', (error) => console.error('Idle database connection error', error.message));
export async function transaction<T>(
  actor: string,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL statement_timeout='10s'");
      await client.query("SELECT set_config('app.actor_id',$1,true)", [actor]);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (!['40P01', '40001'].includes((error as { code: string }).code) || attempt === 2)
        throw error;
    } finally {
      client.release();
    }
    await new Promise((resolve) => setTimeout(resolve, 30 + Math.random() * 60));
  }
  throw new Error('Transaction retry exhausted');
}
