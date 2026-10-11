import { createApp } from './app.ts';
import { pool } from './db/pool.ts';
import { EventHub } from './events.ts';
const events = new EventHub();
await events.start();
const server = createApp(events).listen(Number(process.env.PORT ?? 3001), '0.0.0.0', () =>
  console.log('TaskBid API listening on port', process.env.PORT ?? 3001),
);
async function shutdown() {
  await events.stop();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
