import { Client } from 'pg';
import type { Response } from 'express';
import { databaseUrl } from './db/pool.ts';
export class EventHub {
  private clients = new Set<Response>();
  private db: Client | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  async start() {
    if (this.stopped) return;
    const db = new Client({ connectionString: databaseUrl });
    this.db = db;
    const reconnect = () => {
      if (this.stopped || this.retry) return;
      for (const res of this.clients) res.write('event: resync\ndata: {}\n\n');
      void db.end().catch(() => {});
      this.retry = setTimeout(() => {
        this.retry = undefined;
        void this.start();
      }, 2000);
    };
    db.on('error', reconnect);
    db.on('end', reconnect);
    db.on('notification', (msg) => {
      if (msg.payload)
        for (const res of this.clients) {
          if (res.writableLength > 65536) {
            res.end();
            continue;
          }
          res.write(`event: change\ndata: ${msg.payload}\n\n`);
        }
    });
    try {
      await db.connect();
      await db.query('LISTEN taskbid_changes');
      for (const res of this.clients) res.write('event: resync\ndata: {}\n\n');
    } catch {
      reconnect();
    }
  }
  subscribe(res: Response) {
    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('event: ready\ndata: {}\n\n');
    this.clients.add(res);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
    res.on('close', () => {
      clearInterval(heartbeat);
      this.clients.delete(res);
    });
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    for (const res of this.clients) res.end();
    await this.db?.end().catch(() => {});
  }
}
