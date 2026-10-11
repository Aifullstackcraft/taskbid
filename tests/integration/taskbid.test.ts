import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
// Never point destructive fixtures at the development or production database.
const testUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://taskbid:taskbid@localhost:5433/taskbid_test';
if (!new URL(testUrl).pathname.endsWith('_test'))
  throw new Error('Integration database name must end in _test.');
process.env.DATABASE_URL = testUrl;
const { pool, transaction } = await import('../../apps/api/src/db/pool.ts');
const { migrate } = await import('../../apps/api/src/db/migrate.ts');
const { createApp } = await import('../../apps/api/src/app.ts');
const { EventHub } = await import('../../apps/api/src/events.ts');
const creator = '00000000-0000-4000-8000-000000000001',
  bidder = '00000000-0000-4000-8000-000000000002',
  fallback = '00000000-0000-4000-8000-000000000003';
let server: Server, base: string;
const events = new EventHub();
before(async () => {
  await migrate();
  await events.start();
  server = createApp(events).listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => {
  await events.stop();
  if (server) await new Promise<void>((r) => server.close(() => r()));
  await pool.end();
});
beforeEach(async () => {
  await pool.query('TRUNCATE audit_log,bids,tasks,users RESTART IDENTITY CASCADE');
  await pool.query(
    `INSERT INTO users(id,name,email,hourly_rate,max_capacity) VALUES($1,'Creator','c@test',50,40),($2,'Bidder','b@test',50,10),($3,'Fallback','f@test',50,40)`,
    [creator, bidder, fallback],
  );
});
async function request(path: string, method = 'GET', body?: unknown, user = creator) {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-user-id': user },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json() };
}
async function task(title = 'Test task') {
  const r = await request('/tasks', 'POST', {
    title,
    description: 'Integration fixture',
    complexity: 3,
    deadline: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.equal(r.status, 201);
  return r.data.id as string;
}
async function status(id: string, value: string, user = creator) {
  return request(`/tasks/${id}/status`, 'PATCH', { status: value }, user);
}
async function bid(id: string, hours: number, user = bidder) {
  return request(`/tasks/${id}/bids`, 'POST', { hours }, user);
}
async function closedTask(hours: number, title = 'Closed task', extra?: number) {
  const id = await task(title);
  assert.equal((await status(id, 'open')).status, 200);
  assert.equal((await bid(id, hours)).status, 201);
  if (extra) assert.equal((await bid(id, extra, fallback)).status, 201);
  assert.equal((await status(id, 'bidding_closed')).status, 200);
  return id;
}
async function assign(id: string) {
  return request(`/tasks/${id}/assign`, 'POST');
}
test('two concurrent tasks cannot overbook one user, and the other uses fallback', async () => {
  const x = await closedTask(5, 'X', 6),
    y = await closedTask(7, 'Y', 8);
  // Hold the shared user so both HTTP assignments are forced to contend.
  const blocker = await pool.connect();
  await blocker.query('BEGIN');
  await blocker.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [bidder]);
  const promises = [assign(x), assign(y)];
  try {
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      const r = await pool.query(
        "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'",
      );
      if (r.rows[0].n >= 2) {
        waiting = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(waiting, 'Both transactions must actually overlap and wait on locks.');
  } finally {
    await blocker.query('COMMIT');
    blocker.release();
  }
  const results = await Promise.all(promises);
  assert.deepEqual(
    results.map((r) => r.status),
    [200, 200],
  );
  assert.equal(results.filter((r) => r.data.assignee_id === bidder).length, 1);
  assert.equal(results.filter((r) => r.data.assignee_id === fallback).length, 1);
  const workload = await request(`/users/${bidder}/workload`);
  assert.ok([5, 7].includes(Number(workload.data.current_workload)));
  assert.ok(Number(workload.data.current_workload) <= 10);
});
test('capacity race without fallback allows exactly one assignment', async () => {
  const x = await closedTask(5),
    y = await closedTask(7);
  const r = await Promise.all([assign(x), assign(y)]);
  assert.deepEqual(r.map((x) => x.status).sort(), [200, 409]);
  assert.equal(r.find((x) => x.status === 409)?.data.error.code, 'NO_ELIGIBLE_BIDDER');
});
test('two concurrent assignments for the same task charge workload once', async () => {
  const id = await closedTask(5);
  const r = await Promise.all([assign(id), assign(id)]);
  assert.deepEqual(r.map((x) => x.status).sort(), [200, 409]);
  assert.equal(Number((await request(`/users/${bidder}/workload`)).data.current_workload), 5);
});
test('stale lowest bid is skipped and history preserved', async () => {
  const stale = await closedTask(3, 'Stale', 4),
    other = await closedTask(8);
  assert.equal((await assign(other)).status, 200);
  const r = await assign(stale);
  assert.equal(r.data.assignee_id, fallback);
  const bids = (await request(`/tasks/${stale}/bids`)).data;
  assert.equal(bids.find((b: { user_id: string }) => b.user_id === bidder).status, 'rejected');
});
test('no valid bidder leaves all state and audit rows unchanged', async () => {
  const stale = await closedTask(3),
    other = await closedTask(8);
  await assign(other);
  const before = Number((await pool.query('SELECT count(*) FROM audit_log')).rows[0].count);
  assert.equal((await assign(stale)).status, 409);
  assert.equal((await request(`/tasks/${stale}`)).data.status, 'bidding_closed');
  assert.equal((await request(`/tasks/${stale}/bids`)).data[0].status, 'pending');
  assert.equal(Number((await pool.query('SELECT count(*) FROM audit_log')).rows[0].count), before);
});
test('own-task bid, duplicate bid and excess capacity are rejected', async () => {
  const id = await task();
  await status(id, 'open');
  assert.equal((await bid(id, 1, creator)).data.error.code, 'OWN_TASK_BID');
  assert.equal((await bid(id, 11)).data.error.code, 'CAPACITY_EXCEEDED');
  assert.equal((await bid(id, 5)).status, 201);
  assert.equal((await bid(id, 5)).data.error.code, 'DUPLICATE_BID');
});
test('pending bids do not reserve workload', async () => {
  const x = await task(),
    y = await task();
  await status(x, 'open');
  await status(y, 'open');
  assert.equal((await bid(x, 10)).status, 201);
  assert.equal((await bid(y, 10)).status, 201);
  assert.equal(Number((await request(`/users/${bidder}/workload`)).data.current_workload), 0);
});
test('stale form submit is rejected after another assignment', async () => {
  const draft = await task();
  await status(draft, 'open');
  const other = await closedTask(8);
  await assign(other);
  assert.equal((await bid(draft, 3)).data.error.code, 'CAPACITY_EXCEEDED');
});
test('bid racing with closing either commits before closure or is rejected', async () => {
  const id = await task();
  await status(id, 'open');
  const [b, c] = await Promise.all([bid(id, 2), status(id, 'bidding_closed')]);
  assert.equal(c.status, 200);
  assert.ok([201, 409].includes(b.status));
  assert.equal((await bid(id, 1, fallback)).data.error.code, 'BIDDING_CLOSED');
});
test('lifecycle cannot skip or move backwards; assignment cannot use status endpoint', async () => {
  const id = await task();
  assert.equal((await status(id, 'bidding_closed')).status, 409);
  await status(id, 'open');
  assert.equal((await status(id, 'draft')).status, 409);
  await status(id, 'bidding_closed');
  assert.equal((await status(id, 'assigned')).data.error.code, 'USE_ASSIGN_ENDPOINT');
});
test('roles are enforced, completion releases workload once', async () => {
  const id = await closedTask(5);
  assert.equal((await request(`/tasks/${id}/assign`, 'POST', undefined, bidder)).status, 403);
  await assign(id);
  assert.equal((await status(id, 'in_progress')).status, 403);
  await status(id, 'in_progress', bidder);
  await status(id, 'review', bidder);
  assert.equal((await status(id, 'done', bidder)).status, 403);
  assert.equal((await status(id, 'done')).status, 200);
  assert.equal(Number((await request(`/users/${bidder}/workload`)).data.current_workload), 0);
  assert.equal((await status(id, 'done')).status, 409);
});
test('ties choose earlier bid deterministically', async () => {
  const id = await task();
  await status(id, 'open');
  await bid(id, 2, fallback);
  await bid(id, 2);
  await status(id, 'bidding_closed');
  assert.equal((await assign(id)).data.assignee_id, fallback);
});
test('database rules reject direct SQL bypassing API', async () => {
  const id = await task();
  await status(id, 'open');
  await assert.rejects(
    transaction(creator, (c) =>
      c.query('INSERT INTO bids(task_id,user_id,hours) VALUES($1,$2,1)', [id, creator]),
    ),
    /OWN_TASK_BID/,
  );
  await assert.rejects(
    transaction(creator, (c) => c.query("UPDATE tasks SET status='done' WHERE id=$1", [id])),
    /INVALID_STATUS_TRANSITION/,
  );
  await assert.rejects(
    pool.query('UPDATE users SET current_workload=1 WHERE id=$1', [bidder]),
    /WORKLOAD_MANAGED/,
  );
  await assert.rejects(
    pool.query("UPDATE tasks SET title='Unaudited' WHERE id=$1", [id]),
    /AUDIT_ACTOR_REQUIRED/,
  );
});
test('database assignment cannot exceed capacity even with an accepted bid', async () => {
  const id = await closedTask(7),
    other = await closedTask(5);
  await assign(other);
  await assert.rejects(
    transaction(creator, async (c) => {
      await c.query("UPDATE bids SET status='accepted' WHERE task_id=$1", [id]);
      await c.query(
        "UPDATE tasks SET status='assigned',assignee_id=$2,accepted_hours=7 WHERE id=$1",
        [id, bidder],
      );
    }),
    /CAPACITY_EXCEEDED/,
  );
  assert.equal((await request(`/tasks/${id}/bids`)).data[0].status, 'pending');
});
test('deferred constraint rolls back an accepted bid without assignment and its audit', async () => {
  const id = await closedTask(2),
    before = (await request(`/tasks/${id}/audit`)).data.length;
  await assert.rejects(
    transaction(creator, (c) =>
      c.query("UPDATE bids SET status='accepted' WHERE task_id=$1", [id]),
    ),
    /ASSIGNMENT_INCONSISTENT/,
  );
  assert.equal((await request(`/tasks/${id}/audit`)).data.length, before);
});
test('audit captures old/new values and actor, and cannot be edited', async () => {
  const id = await task();
  await status(id, 'open');
  const entries = (await request(`/tasks/${id}/audit`)).data;
  assert.equal(entries[0].actor_id, creator);
  assert.equal(entries[0].old_values.status, 'draft');
  assert.equal(entries[0].new_values.status, 'open');
  assert.equal(entries[1].operation, 'INSERT');
  await assert.rejects(
    pool.query("UPDATE audit_log SET operation='HIDDEN'"),
    /DELETE_NOT_SUPPORTED/,
  );
});
test('dashboard aggregates are correct without join multiplication', async () => {
  const id = await closedTask(2, 'Complete', 4);
  await assign(id);
  await status(id, 'in_progress', bidder);
  await status(id, 'review', bidder);
  await status(id, 'done');
  const overdue = await task('Overdue');
  await transaction(creator, (c) =>
    c.query("UPDATE tasks SET deadline=now()-interval '1 day' WHERE id=$1", [overdue]),
  );
  const r = await request('/dashboard/stats');
  assert.equal(r.data.by_status.length, 7);
  assert.equal(r.data.by_status.find((x: { status: string }) => x.status === 'done').count, 1);
  assert.equal(
    r.data.average_by_complexity.find((x: { complexity: number }) => x.complexity === 3)
      .average_hours,
    3,
  );
  assert.equal(r.data.top_users[0].id, bidder);
  assert.equal(r.data.overdue_without_bids[0].id, overdue);
});
test('validation, missing entities and unknown actors return useful errors', async () => {
  assert.equal((await request('/tasks', 'POST', {})).status, 400);
  assert.equal((await request('/tasks/not-a-uuid')).status, 400);
  assert.equal((await request('/tasks/99999999-9999-4999-8999-999999999999')).status, 404);
  assert.equal(
    (await request('/tasks', 'POST', {}, '99999999-9999-4999-8999-999999999999')).data.error.code,
    'UNKNOWN_USER',
  );
  const id = await task();
  await status(id, 'open');
  assert.equal((await bid(id, 1.234)).status, 400);
});
test('SSE publishes committed changes and no rolled-back changes', async () => {
  const controller = new AbortController();
  const response = await fetch(base + '/events', { signal: controller.signal });
  assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let output = '';
  const read = (async () => {
    try {
      while (true) {
        const r = await reader.read();
        if (r.done) break;
        output += decoder.decode(r.value);
      }
    } catch {}
  })();
  try {
    const id = await task();
    await status(id, 'open');
    await bid(id, 2);
    for (let i = 0; i < 100 && !/"entity"\s*:\s*"bids"/.test(output); i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.ok(/"entity"\s*:\s*"bids"/.test(output));
    assert.ok(output.includes(id));
    const before = output.split('event: change').length;
    await assert.rejects(
      transaction(creator, async (c) => {
        await c.query("UPDATE tasks SET title='Rolled back' WHERE id=$1", [id]);
        throw new Error('rollback');
      }),
    );
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(output.split('event: change').length, before);
  } finally {
    controller.abort();
    await read;
  }
});
