# TaskBid

A collaborative task marketplace built with React, Express, TypeScript, and PostgreSQL. Team members bid in hours; assignment selects the lowest bidder who still has capacity, atomically.

**Repository:** [Aifullstackcraft/taskbid](https://github.com/Aifullstackcraft/taskbid) (private; reviewers require access).

**Deployment:** the free Render configuration is prepared in `render.yaml`, and the source is pushed to GitHub. Render account access, resource creation, and live verification are pending. A verified live URL and a 10-minute Loom walkthrough must be added before submission. See [the deployment guide](docs/DEPLOYMENT.md).

## Run locally

Requirements: Docker Desktop with its Linux engine running. From the repository root:

```sh
docker compose up --build
```

Open **http://localhost:3001**. Compose starts PostgreSQL, waits for database health, applies ordered SQL migrations, seeds an empty database, and starts Express serving the production React bundle. Data survives restarts in a Docker volume. No cloud service is involved.

## Develop with hot reload

Requirements: Node.js 24 LTS, npm, Docker.

```sh
npm ci
docker compose up -d db
npm run db:migrate
npm run db:seed
npm run dev
```

Open **http://localhost:5173**. The frontend proxies `/api` to Express on port 3001, including the event stream. PostgreSQL uses host port **5433** to avoid conflicts with an existing local PostgreSQL installation. Inside Docker, PostgreSQL still uses port 5432.

The default URLs already work for Compose. Copy `.env.example` to `.env` in the root if you need overrides. For a separate frontend/backend later, set `VITE_API_URL` at frontend build time and `WEB_ORIGIN` on the server. The compiled server supports `/api/...` as well as the exact unprefixed assignment endpoints.

## Verification

Create the separate test database once:

```sh
docker compose exec -T db psql -U taskbid -d taskbid -c "CREATE DATABASE taskbid_test;"
```

Then:

```sh
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

Integration tests use real PostgreSQL and reset only the database whose name ends in `_test`. `TEST_DATABASE_URL` can override its connection string. Never use an important database for fixtures. Browser tests exercise the seeded development database and create a uniquely named task; they do not clear existing development data.

`npm test` includes a deterministic overlapping-capacity test: it blocks the shared user row, starts both HTTP assignment requests, verifies that both transactions are waiting on database locks, then releases the blocker and checks the result. This establishes real contention, rather than assuming `Promise.all` alone proves overlap.

## Demo users and scenarios

- Ayesha Khan creates and manages seeded tasks. Choose her to open/close bidding, assign, or approve completion.
- Omar Ali has 10 hours of capacity. The two closed race-demo tasks offer 5 and 7 hours through Omar, with Bilal as fallback.
- Sara Ahmed has a 22-hour assignment against 24-hour capacity. Her earlier 3-hour bid on the stale-bid task is now invalid; Bilal's 4-hour bid should win.
- Maya Chen is available for a fresh bid and complete workflow demonstration.
- Tasks cover every lifecycle stage, and an expired task with zero bids appears on the dashboard.

The task lifecycle is `draft → open → bidding_closed → assigned → in_progress → review → done`. Creator manages opening, closure, assignment, and final approval. Assignee starts work and submits review. The dropdown simulates identity; there is deliberately no real authentication.

## API

Reads do not require identity. Mutations require `x-user-id` containing an existing user UUID.

- `POST /tasks`: `{title, description, complexity, deadline}`; starts in draft. Deadline is an ISO timestamp with timezone.
- `PATCH /tasks/:id/status`: `{status}`; exactly one stage forward. Use assignment endpoint for the assigned stage.
- `POST /tasks/:id/bids`: `{hours}`; positive number, at most two decimal places.
- `GET /tasks/:id/bids`: ascending hours, then placement timestamp and UUID.
- `POST /tasks/:id/assign`: no body; creator only, bidding must be closed.
- `GET /users/:id/workload`: active workload, maximum capacity, remaining capacity.
- `GET /dashboard/stats`: four aggregates in one SQL statement.
- Supporting reads: `GET /users`, `GET /tasks`, `GET /tasks/:id`, `GET /tasks/:id/audit`.
- `GET /events`: SSE notifications and reconnect refresh signals.
- `GET /health`: database readiness check.

Errors have `{error: {code, message, details?}}`. Validation returns 400, forbidden actions 403, missing records 404, state conflicts 409, and transient database contention 503. Caller-visible database rule errors use stable codes, not raw SQL details.

## The four assignment challenges

**A. Capacity race:** assignment locks the task, then all candidate user rows in UUID order. Capacity is rechecked in SQL after locks are acquired. Task/bid/workload/audit updates commit together. Other assignments sharing a user must wait and then see the updated workload. Task locks also prevent double assignment of one task. Deadlock/serialization failures retry the complete transaction up to three attempts.

**B. Stale bid:** bids do not reserve capacity. A bid can become ineligible later. Assignment skips it, chooses the next eligible bidder, and preserves all bid history. On successful assignment, the winner is accepted and other pending bids are rejected. If no one fits, the transaction rolls back and all bids remain pending.

**C. Dashboard query:** independent CTEs aggregate status counts, bid hours by complexity, completed-task leaders, and overdue tasks with no bids. They are assembled into one JSON result. This avoids multiplying task counts through one-to-many bid joins, returns zero-count lifecycle stages, and uses one statement snapshot.

**D. Audit:** database triggers record actor, timestamp, operation, and full old/new JSON snapshots for task and bid inserts/updates. Actor context is transaction-local so pooled connections cannot leak one user's identity into another transaction. No-op updates produce no audit event. Deletes are unsupported; audit updates/deletes are rejected. Audit writes and event notifications roll back with the business transaction.

## Why database constraints?

API validation provides good error messages, but another client, script, or concurrent request can bypass its assumptions. Foreign keys, unique indexes, checks, and locking triggers make PostgreSQL the final authority. Cross-table rules cannot be expressed as simple row-local `CHECK` constraints. Deferred triggers additionally ensure the accepted bid and task assignment agree at commit.

Trade-offs: PostgreSQL-specific business logic, more complex migrations, harder unit isolation, and locking overhead. We accept these because this assignment evaluates shared-state correctness and SQL. Database administrators can disable triggers or truncate tables; these guarantees concern ordinary writes with rules enabled, not malicious superuser access. A separate restricted runtime database role is a future hardening step.

## Why SSE?

The browser sends changes through REST and needs one-way invalidation notifications. PostgreSQL `LISTEN/NOTIFY` emits only after commit; a dedicated database connection forwards notifications to SSE clients. Heartbeats, connection cleanup, bounded buffering, reconnection, and refetch-on-reconnect are included. Multiple backend instances can each listen on the database channel. Notifications are not durable; clients refetch authoritative state after reconnect rather than replaying events. A session-level PostgreSQL connection is required; transaction-pooling proxies cannot host the listener.

## Interpretations and scope

Capacity is an active-work ceiling measured in hours, not a calendar scheduling engine. Assigned, in-progress, and review tasks consume their accepted hours; done tasks release them. Deadline is a completion deadline and does not automatically close bidding. Equal bids use earliest timestamp then UUID. Bids cannot be edited, tasks cannot be reassigned or deleted, and lifecycle cannot move backwards. Average bid amount means hours; completed-task ranking uses the assignee.

Core requirements and the concurrency-test bonus are implemented. The optional global optimization endpoint and outbid-toast system are outside this implementation. No deployment, cloud resources, CI/CD pipeline, microservices, or Loom recording has been created.

## Learn the implementation

Read [docs/IMPLEMENTATION_GUIDE.md](docs/IMPLEMENTATION_GUIDE.md) for the full walkthrough, SQL explanations, file map, transaction timelines, alternatives, interview questions, and manual demos. [DECISIONS.md](DECISIONS.md) is the concise decision record. [docs/LOOM_OUTLINE.md](docs/LOOM_OUTLINE.md) is a recording plan for the later submission.

## References

- [PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)
- [PostgreSQL row locking](https://www.postgresql.org/docs/current/explicit-locking.html)
- [Transactional NOTIFY](https://www.postgresql.org/docs/current/sql-notify.html)
- [LISTEN session behavior](https://www.postgresql.org/docs/current/sql-listen.html)
- [Express 5 error handling](https://expressjs.com/en/guide/error-handling.html)

These are supporting technical references. The confidential assignment document is not included in this repository.
