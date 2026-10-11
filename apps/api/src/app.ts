import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { statuses } from '@taskbid/contracts';
import { pool, transaction } from './db/pool.ts';
import { AppError, errorHandler } from './errors.ts';
import { assignTask, getTask, lockTask, requireCreator, taskSelect } from './modules/tasks.ts';
import { dashboardStats } from './modules/dashboard.ts';
import type { EventHub } from './events.ts';
import path from 'node:path';
import { existsSync } from 'node:fs';
const uuid = z.uuid();
const hours = z
  .number()
  .positive()
  .max(10000)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-7, 'Use at most two decimal places.');
export function createApp(events?: EventHub) {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    cors({
      origin: process.env.WEB_ORIGIN ?? process.env.RENDER_EXTERNAL_URL ?? 'http://localhost:5173',
    }),
  );
  app.use(express.json({ limit: '32kb' }));
  const webDirectory = path.resolve(import.meta.dirname, '../../web/dist');
  const compiledWebDirectory = path.resolve(process.cwd(), '../web/dist');
  const staticDirectory = existsSync(webDirectory) ? webDirectory : compiledWebDirectory;
  app.use((req, res, next) => {
    res.locals.apiRequest = req.url.startsWith('/api/');
    if (res.locals.apiRequest) req.url = req.url.slice(4);
    // Browser navigation to /tasks/:id must load React, while /api/tasks/:id returns JSON.
    if (
      !res.locals.apiRequest &&
      req.method === 'GET' &&
      req.headers.accept?.includes('text/html') &&
      existsSync(staticDirectory)
    ) {
      res.sendFile(path.join(staticDirectory, 'index.html'));
      return;
    }
    next();
  });
  if (existsSync(staticDirectory)) app.use(express.static(staticDirectory));
  app.get('/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  });
  app.get('/events', (_req, res) => {
    if (!events) throw new AppError(503, 'EVENTS_UNAVAILABLE', 'Real-time updates unavailable.');
    events.subscribe(res);
  });
  app.get('/users', async (_req, res) => {
    res.json(
      (
        await pool.query(
          'SELECT *, (max_capacity-current_workload)::text remaining_capacity FROM users ORDER BY name',
        )
      ).rows,
    );
  });
  app.get('/users/:id/workload', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const result = await pool.query(
      'SELECT *, (max_capacity-current_workload)::text remaining_capacity FROM users WHERE id=$1',
      [id],
    );
    if (!result.rows[0]) throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
    res.json(result.rows[0]);
  });
  app.get('/tasks', async (_req, res) =>
    res.json((await pool.query(`${taskSelect} ORDER BY t.created_at DESC,t.id`)).rows),
  );
  app.get('/tasks/:id', async (req, res) => res.json(await getTask(uuid.parse(req.params.id))));
  app.get('/tasks/:id/bids', async (req, res) => {
    const id = uuid.parse(req.params.id);
    await getTask(id);
    res.json(
      (
        await pool.query(
          `SELECT b.*,u.name user_name,(b.hours<=u.max_capacity-u.current_workload OR b.status='accepted') currently_eligible FROM bids b JOIN users u ON u.id=b.user_id WHERE task_id=$1 ORDER BY hours,created_at,b.id`,
          [id],
        )
      ).rows,
    );
  });
  app.get('/tasks/:id/audit', async (req, res) => {
    const id = uuid.parse(req.params.id);
    await getTask(id);
    res.json(
      (
        await pool.query(
          `SELECT a.*,u.name actor_name FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id WHERE (a.entity_type='tasks' AND a.entity_id=$1) OR (a.entity_type='bids' AND a.entity_id IN (SELECT id FROM bids WHERE task_id=$1)) ORDER BY a.id DESC`,
          [id],
        )
      ).rows,
    );
  });
  app.get('/dashboard/stats', async (_req, res) => res.json(await dashboardStats()));
  // The switcher is simulation, not authentication. Reject unknown actors before mutations.
  app.use(async (req, _res, next) => {
    if (!['POST', 'PATCH'].includes(req.method)) {
      next();
      return;
    }
    const actor = uuid.parse(req.header('x-user-id'));
    const user = await pool.query('SELECT id FROM users WHERE id=$1', [actor]);
    if (!user.rowCount) throw new AppError(400, 'UNKNOWN_USER', 'Select an existing user.');
    next();
  });
  app.post('/tasks', async (req, res) => {
    const body = z
      .object({
        title: z.string().trim().min(1).max(160),
        description: z.string().trim().max(10000),
        complexity: z.number().int().min(1).max(5),
        deadline: z.iso.datetime({ offset: true }),
      })
      .strict()
      .parse(req.body);
    const actor = req.header('x-user-id')!;
    const task = await transaction(actor, async (c) => {
      const r = await c.query(
        'INSERT INTO tasks(title,description,complexity,deadline,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id',
        [body.title, body.description, body.complexity, body.deadline, actor],
      );
      return getTask(r.rows[0].id, c);
    });
    res.status(201).json(task);
  });
  app.patch('/tasks/:id/status', async (req, res) => {
    const id = uuid.parse(req.params.id),
      actor = req.header('x-user-id')!;
    const { status } = z
      .object({ status: z.enum(statuses) })
      .strict()
      .parse(req.body);
    const task = await transaction(actor, async (c) => {
      const t = await lockTask(c, id);
      if (status === 'assigned')
        throw new AppError(
          409,
          'USE_ASSIGN_ENDPOINT',
          'Use automatic assignment to select a bidder.',
        );
      if (['in_progress', 'review'].includes(status)) {
        if (t.assignee_id !== actor)
          throw new AppError(403, 'FORBIDDEN', 'Only the assignee can start or submit work.');
      } else requireCreator(t, actor);
      if (statuses.indexOf(status) !== statuses.indexOf(t.status) + 1)
        throw new AppError(409, 'INVALID_STATUS_TRANSITION', 'Advance exactly one stage.');
      await c.query('UPDATE tasks SET status=$2 WHERE id=$1', [id, status]);
      return getTask(id, c);
    });
    res.json(task);
  });
  app.post('/tasks/:id/bids', async (req, res) => {
    const id = uuid.parse(req.params.id),
      actor = req.header('x-user-id')!;
    const body = z.object({ hours }).strict().parse(req.body);
    const bid = await transaction(actor, async (c) => {
      await lockTask(c, id);
      return (
        await c.query('INSERT INTO bids(task_id,user_id,hours) VALUES($1,$2,$3) RETURNING *', [
          id,
          actor,
          body.hours,
        ])
      ).rows[0];
    });
    res.status(201).json(bid);
  });
  app.post('/tasks/:id/assign', async (req, res) =>
    res.json(await assignTask(uuid.parse(req.params.id), req.header('x-user-id')!)),
  );
  if (existsSync(staticDirectory))
    app.get('/{*splat}', (req, res, next) => {
      if (
        !res.locals.apiRequest &&
        req.accepts('html') &&
        req.headers.accept?.includes('text/html')
      )
        res.sendFile(path.join(staticDirectory, 'index.html'));
      else next();
    });
  app.use((_req, res) =>
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } }),
  );
  app.use(errorHandler);
  return app;
}
