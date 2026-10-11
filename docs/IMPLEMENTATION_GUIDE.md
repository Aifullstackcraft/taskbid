# TaskBid: end-to-end implementation and interview guide

This guide explains the application we built, how to read it, why its decisions are appropriate for the assignment, and where the limits are. Use it with the actual source files open. Understanding the transaction is more valuable than memorizing a summary.

## 1. The product in one minute

TaskBid is a team marketplace where effort estimates are bids. The creator posts a task; another user offers the number of hours needed. The system chooses the smallest offer from someone who still has capacity at assignment time.

The important word is **still**. A user may have capacity when bidding and lose it by accepting other work. The frontend may also display a stale workload. PostgreSQL must protect the current state when changes are committed.

This is different from a monetary auction. Hourly rate is stored because the entity requires it, but the winner is selected by offered hours, not price or hours multiplied by rate. No billing subsystem is implied.

## 2. Suggested reading order

1. Read `DECISIONS.md` to understand our interpretations.
2. Read `db/migrations/001_schema.sql` for entities and ordinary constraints.
3. Read `db/migrations/002_rules_and_audit.sql` for cross-table rules and auditing.
4. Read `apps/api/src/db/pool.ts` for connection and transaction handling.
5. Read `apps/api/src/modules/tasks.ts`, especially `assignTask`.
6. Read `apps/api/src/app.ts` for endpoint validation and permissions.
7. Read `apps/api/src/modules/dashboard.ts` for aggregation.
8. Read `apps/api/src/events.ts` for real-time delivery.
9. Read `packages/contracts/src/index.ts` for API shapes.
10. Read `apps/web/src/App.tsx`, `api.ts`, and the feature components.
11. Read the integration and browser tests to see what is actually verified.

## 3. Why this architecture

One React app talks to one Express API, which uses one PostgreSQL database. Both applications use TypeScript. npm workspaces share one lockfile and the small contracts package.

The responsibility boundaries are deliberate:

- React owns presentation, selected user, inputs, and cache refresh.
- Express owns input parsing, workflow permissions, transaction coordination, and public errors.
- PostgreSQL owns durable data and business invariants under concurrency.

There is no generic repository framework or service interface for every entity. We have one task module and one dashboard module because those contain meaningful database behavior. More abstractions would increase the amount of code needed to understand a small system.

**Trade-off:** some SQL lives directly in route handlers. That is reasonable for simple supporting reads. Assignment is separated because it is the critical multi-step operation. If the API grows, extract cohesive user and audit modules rather than inventing one abstraction per SQL statement.

## 4. Schema: users

`users` stores UUID identity, name, unique email, hourly rate, maximum capacity, and current workload. The UUID is the key; the email remains a business uniqueness rule.

Rates use `numeric(10,2)`. Workload and capacity also use `numeric(10,2)` so decimal-hour estimates have exact database arithmetic. Positive capacity, nonnegative rate, and `0 <= workload <= capacity` are row-local CHECK constraints.

The workload is a stored counter. Its meaning is the total accepted hours of the user's assigned, in-progress, and review tasks. It is not all bids and not a historical total of completed work. A task reaching done releases its accepted hours.

**Why a counter?** A user row becomes an obvious common lock target for competing assignments, capacity checks are cheap, and the database can enforce a row-local upper bound.

**Alternative:** calculate workload from active tasks on every read. This avoids duplicate storage, but you still need to lock the user row before calculating and assigning. Without that shared lock, transactions writing different task rows can each see an old total and collectively exceed capacity. The counter is an optimization and convenient constraint target; the user lock is the coordination mechanism.

`guard_workload` rejects ordinary direct edits to the counter. Only nested task-trigger updates may change it. This is pragmatic within the closed set of application writes. It is not a security boundary against an administrator who can create triggers, disable them, or truncate tables.

## 5. Schema: tasks

`tasks` stores creator, title, description, complexity, deadline, lifecycle status, assignee, accepted hours, and creation timestamp.

Complexity is 1–5. Deadline is `timestamptz`, representing a point in time, and the browser formats it in the viewer's locale/timezone. The API requires an ISO timestamp with a timezone offset.

The assignment fields must agree with status: draft/open/closed tasks have no assignee or accepted hours; assigned/in-progress/review/done tasks have both. This prevents an apparently assigned task with no actual owner.

The lifecycle guard requires insertions to start in draft and updates to advance exactly one stage. A task cannot jump from open to done, reopen, or silently change assignee after assignment. The API applies the same rules for useful errors; PostgreSQL is the final authority if the API is bypassed.

**Deadline interpretation:** it is a completion deadline, not an automatic bidding cutoff. Bidding is allowed only in the open state. The assignment gives an explicit close-bidding lifecycle and asks for overdue tasks with zero bids, so we did not invent a scheduler that closes them automatically.

## 6. Schema: bids

`bids` contains task, user, hours, status, and placement timestamp. Hours must be positive. The API additionally allows at most two decimal places and an explicit reasonable upper input bound.

`UNIQUE(task_id, user_id)` ensures one bid per person per task. An application-only duplicate check has a race: two requests can both observe no existing bid and insert. The unique constraint resolves this even under simultaneous requests.

The partial unique index on task ID where status is accepted ensures no two bids win one task. Pending offers can coexist. On successful assignment, one becomes accepted and the rest become rejected. Rejected means not selected in that completed auction; it does not claim every losing bidder lacked capacity.

Bid values and ownership are immutable after insertion. We did not add bidding revisions because the specification requires one bid and defines no edit policy. Editing estimates during assignment would complicate ranking and history.

## 7. Constraints versus triggers

Use CHECK for facts that depend on one row: positive hours, allowed statuses, valid complexity. Use foreign keys for relationships. Use unique indexes for duplicate prevention.

The following rules depend on other rows and use triggers:

- A bidder must not be the task creator.
- The task must currently be open.
- The bidder must currently fit within capacity.
- Assignment must match an accepted bid.
- Assignment changes the user's workload.
- Every task/bid change must have an audit record.

A trigger is not automatically concurrency-safe. `guard_bid` locks the task row before checking its status and locks the bidder before checking workload. Otherwise another transaction could close the task or consume capacity between the check and write.

**Interview answer:** “I use ordinary constraints wherever possible and locking triggers where the rule crosses tables. The lock is essential; merely moving a check into a trigger does not fix a race.”

## 8. The transaction helper

`pool.ts` creates a PostgreSQL connection pool with a finite limit. Idle connection errors are handled so they do not become unhandled event-emitter errors.

`transaction(actor, work)` acquires one connection, begins a transaction, sets timeouts and actor context, calls the work function, commits, and releases the connection. If work or COMMIT fails, it rolls back. COMMIT itself can fail because deferred constraints run there.

All statements inside the transaction use the supplied client. Calling `pool.query` from inside the work callback would allow another pooled connection to run a statement outside the transaction. That is an easy and serious mistake.

The actor is set with `set_config('app.actor_id', actor, true)`. The final `true` means transaction-local. Session-wide settings would leak across pooled requests unless reset perfectly every time. Transaction-local context disappears at commit/rollback.

Lock timeout is five seconds and statement timeout is ten seconds. A request should not wait indefinitely while holding a pool connection. These are small-demo limits, not universal production tuning values.

Deadlock (`40P01`) and serialization (`40001`) failures retry the entire transaction up to three attempts, with short jitter between attempts. Business conflicts do not retry because their meaning is not transient. The callback has database-only effects; emailing or publishing externally inside it would risk repeating that side effect on retry.

## 9. Assignment, line by line conceptually

`assignTask` performs these operations:

1. Lock the task with `SELECT ... FOR UPDATE`.
2. Verify the actor is the creator.
3. Verify the task is closed and not already assigned.
4. Read pending bids in hours/time/ID order.
5. Lock all candidate users in UUID order.
6. Query again for the lowest pending bid whose user workload plus offered hours does not exceed capacity.
7. Mark that bid accepted and other pending bids rejected.
8. Set task status, assignee, and accepted hours.
9. Let the task trigger update workload and audit triggers record changes.
10. Commit the transaction, including deferred consistency checks.

The capacity comparison is SQL NUMERIC arithmetic. JavaScript's `0.1 + 0.2` is not exactly `0.3`, so converting database numbers and comparing the sum in Node could incorrectly reject an exact-fit decimal offer. PostgreSQL makes the final choice.

The bid list is stable because the task lock serializes placement, status changes, and assignment. Candidate capacity becomes stable once the user locks are held. The eligible-winner query runs after those locks, using a fresh READ COMMITTED statement snapshot.

## 10. Two different concurrency problems

**Same task, two assignment requests:** both need the same task lock. One succeeds and changes status. The other waits, then sees an assigned task and returns a conflict. Workload is charged once.

**Different tasks, same bidder:** each can lock its own task, so task locking alone is insufficient. Both then need the same user lock. The second waits and evaluates the capacity after the first has committed.

With 10 free hours and bids of 5 and 7 hours, either may win first. Scheduling determines which transaction obtains the lock first; there is no global priority across separate tasks. After a 5-hour assignment, the 7-hour offer no longer fits. After a 7-hour assignment, the 5-hour offer no longer fits.

If another bidder fits the second task, assignment falls back and both HTTP requests can succeed. That does not mean the shared user receives both tasks. Without fallback, exactly one request succeeds and the other returns `NO_ELIGIBLE_BIDDER`.

## 11. Why lock users in a different order from bid ranking?

Task X could rank Alice before Bob while Task Y ranks Bob before Alice. If each transaction locks in ranking order, X can hold Alice and wait for Bob while Y holds Bob and waits for Alice: a deadlock cycle.

We lock candidates in UUID order for coordination, then use hours/time/ID order for winner selection. These are separate concerns. Locking does not decide who wins.

Locking every candidate is conservative. It can temporarily block other assignments that share a losing candidate. For a small team this is acceptable and easy to explain. Larger auctions could use conditional capacity updates or a carefully designed database function to reduce contention. They still need deterministic task coordination and full rollback behavior.

Do not use `SKIP LOCKED` casually here. It would allow a higher bidder to win just because the lowest bidder was temporarily locked. That changes product behavior. Waiting and rechecking matches the chosen semantics.

## 12. Why READ COMMITTED rather than SERIALIZABLE?

The protected invariants have explicit shared lock targets: task state and user capacity. Every workload change locks/updates the user. Under READ COMMITTED, the eligibility query after waiting sees newly committed capacity.

SERIALIZABLE could detect more general predicate conflicts and is a valid alternative, but requires retrying serialization failures and explaining which anomalies it prevents. We chose simpler explicit locking for this bounded problem. A transaction at READ COMMITTED without the user lock would still be wrong.

If a future feature relies on a global predicate, such as “at most N active tasks across this whole team,” reconsider its shared lock target or isolation level. Do not assume this lock scheme automatically protects every new rule.

## 13. Deferred assignment consistency

Assignment updates the winning bid and task in separate statements. Between those statements, the database temporarily contains an accepted bid on a closed task. Rejecting that intermediate state immediately would prevent a valid transaction.

Constraint triggers are deferred until COMMIT. They query the final task and accepted bid and require matching user/hours. A bid cannot remain accepted without an assignment. A task cannot be assigned to a different bid value. The partial unique index still prevents multiple winners immediately.

This distinguishes **valid intermediate transaction state** from **valid committed state**. Other normal readers do not see uncommitted intermediate changes. If final consistency fails, everything rolls back, including the audit rows generated earlier.

## 14. Stale bids and no-winner behavior

A pending bid is an offer, not a reservation. Reserving capacity for every bid would prevent users from bidding on multiple opportunities and would require release/expiry rules that were not requested.

A bid of 3 hours can become invalid when the user has 2 hours left. We preserve the offer and evaluate current capacity during assignment. A later, larger offer from another user can therefore win legitimately.

On successful assignment, all remaining pending bids are rejected. Before assignment the UI can show “Capacity changed” for a pending bid that currently does not fit. It may become eligible again if another task completes; pending status does not mean permanent invalidity.

When nobody fits, no statuses or audit records change. The task remains bidding_closed. Because the lifecycle cannot go backwards, there is no reopening feature. Capacity may become available after existing work completes; the creator can then retry assignment. A future cancellation/new-auction feature needs an explicit lifecycle decision.

## 15. Audit design

`record_change` runs after task and bid INSERT/UPDATE. It records entity type/ID, SQL operation, actor, timestamp, and full old/new JSON snapshots. INSERT has no previous row. An UPDATE with identical JSON values creates no entry.

Capturing full snapshots is simple and preserves every changed field. A diff-only log would use less space but require more reconstruction logic when reviewing history. At this scale, clarity wins.

Database triggers cover direct SQL changes that application middleware might miss. Missing actor context rejects the change instead of silently logging an unknown user. Demo seed operations explicitly use Ayesha as their actor. This is demo history, not a claim that those events came from real human interactions.

Audit UPDATE/DELETE and task/bid DELETE are blocked for ordinary writes. We did not implement deletion because there is no defined deletion lifecycle or retention policy. Administrators with DDL/TRUNCATE privileges remain powerful; this is not a tamper-proof forensic ledger. Production would separate migration/admin and restricted runtime roles.

## 16. Dashboard query explained

One SQL statement uses independent CTEs:

- `status_counts`: generate all seven lifecycle values, left join tasks, count task IDs. `count(t.id)` avoids counting the synthetic empty row as a task.
- `averages`: generate all five complexity levels, join tasks and their bids, average offered hours. No bids yields null, not a misleading zero estimate.
- `leaders`: join completed tasks to assignees, group users, order by completed count and stable name/ID tie breakers, limit three.
- `overdue`: use deadline before `now()` and `NOT EXISTS` any bid. This tests whether a task has ever received a bid, irrespective of bid status.

Each CTE becomes a JSON array and the final result is one object. An empty array is returned instead of null for missing groups of records.

Why not join everything once? A task with three bids would create three joined rows. Counting those rows as tasks or completions produces inflated metrics. Independent aggregation avoids that without sprinkling DISTINCT everywhere to repair a flawed join.

One statement also gives one snapshot for all metrics. Four separate READ COMMITTED statements could observe different moments as users change tasks. Four queries are not inherently unacceptable, but here a single explicit statement is concise and demonstrably correct.

## 17. Indexes and query patterns

The bid ranking index begins with task ID and then hours/timestamp/ID. Task ID is used for filtering, and the remaining keys match ordering. The unique task/user index supports duplicate checks and task-related lookups.

Task status supports grouping/filtering. Assignee/status supports active-work and completion-oriented reads. Deadline supports overdue work. Audit entity/type/ID ordering supports per-entity history.

Indexes cost storage and write work. The small demo may use sequential scans because they are cheaper. An index existing does not guarantee PostgreSQL uses it. For meaningful tuning, seed a realistic volume and use `EXPLAIN (ANALYZE, BUFFERS)`; do not claim measured speedups from a handful of rows.

The task-board query uses correlated bid count/minimum subqueries. Those are straightforward at small scale and benefit from task-leading indexes. A large board should paginate and potentially aggregate bids once for the requested page. Current endpoints intentionally return the small team's complete dataset.

## 18. API validation and errors

Zod checks UUIDs, task fields, ISO deadline, complexity, allowed status, and positive two-decimal hours. Strict request objects reject unexpected fields; clients cannot pass their own status/assignee in task creation.

All mutations verify an existing `x-user-id`. This is simulated identity, not authentication. Anyone who knows a UUID can impersonate that user. CORS is browser configuration, not a substitute for authentication.

Permissions are application workflow rules. Creator opens/closes/assigns/approves; assignee starts and submits review. Database invariants additionally protect lifecycle/capacity/ownership even when ordinary SQL bypasses those permission checks. We do not claim full database-level authorization for each actor action.

Errors distinguish invalid input, forbidden action, missing record, business conflict, transient contention, and unexpected failure. The public error includes a stable code and readable message. Raw stack traces and SQL text are logged only on the server. Express 5 forwards rejected asynchronous route promises to the error handler.

A 409 means retrying the exact same operation immediately may not solve it. Refresh capacity, change input, or wait for the state to change. A 503 contention error explicitly allows a later retry. Mutations are not automatically retried by React Query because that can cause unintended repeated writes.

## 19. Real-time path from SQL to browser

The audit trigger calls `pg_notify` with task ID, entity type, and actor ID. PostgreSQL delivers the notification after the transaction commits. A rollback produces neither persistent audit rows nor a notification.

`EventHub` owns a dedicated PostgreSQL connection and executes LISTEN. It forwards each notification to every connected SSE response as a change event. HTTP response headers disable caching/buffering, and a heartbeat comment is sent every 15 seconds.

Disconnected HTTP clients are removed and their heartbeat timer is cleared. Clients with too much buffered output are disconnected rather than allowing unbounded memory accumulation. On database-listener errors, the hub reconnects after two seconds and emits a resync hint.

The React shell establishes one EventSource. On ready, change, or resync, it invalidates query caches. Active queries refetch task/bid/workload/stat data. This avoids trusting an event payload as a complete authoritative record.

**Alternatives:** polling is easiest and expressly allowed, but incurs requests even without changes and adds delay. WebSockets offer two-way communication, which this feature does not need. SSE fits one-way invalidation while keeping mutations as normal REST.

**Limits:** LISTEN/NOTIFY is not a durable queue. Events can be missed during disconnects. We recover current state by refetching on reconnect, not replaying every event. Multiple Express instances can each LISTEN, but transaction pooling cannot preserve the listener's session. Later deployment must supply a direct/session connection for it.

## 20. React state and component responsibilities

`main.tsx` creates QueryClient and BrowserRouter. Queries retry one failed read and are considered fresh for ten seconds; SSE invalidation can refresh them sooner. Window-focus refetch helps recover stale reads as well.

`App.tsx` owns shell/navigation, selected user, user list, and SSE connection. The selected UUID is persisted in localStorage. If it no longer exists, the first demo user is selected. The dashboard loads lazily so its charting bundle need not be loaded for the initial board.

`Board.tsx` fetches tasks, filters by title, groups them into lifecycle columns, displays current-user capacity, and opens task creation. It uses normal links for detail navigation. The board scrolls horizontally rather than squeezing seven columns into unreadable cards. Small screens use compact navigation and stacked detail panels.

`CreateTask.tsx` submits a strict draft payload. The local date/time input becomes an ISO timestamp before submission. It has native required/length validation and shows server errors. Success invalidates queries and navigates to the created task.

`Detail.tsx` fetches task, bids, workload, and audit with separate query keys. The selected actor is passed to mutations. Workload keys contain the user UUID, preventing one user's cached capacity from being mistaken for another's.

`Dashboard.tsx` consumes the server aggregates rather than recalculating business metrics in React. It includes a labeled average-hours-by-complexity bar chart, status counts, contributors, and overdue links. `ui.tsx` contains the small shared formatting and error helpers; it is not a design-system framework.

## 21. Client-side validation and stale-form recovery

The bid form's maximum is the latest fetched remaining capacity. It requires positive hours, a two-decimal step, and disables submission above the current maximum. Own-task users and users who already bid do not see an active bid form.

These controls improve usability, but the capacity could change immediately before the request arrives. The database rechecks under locks. On a server failure, the input is preserved and workload/user queries are invalidated. The message tells the user that capacity may have changed and they should reduce the offer. On success, the form clears and the recorded bid appears.

Do not describe the client as enforcing the invariant. It displays a best-current estimate; the transactional database check decides whether the write is valid.

## 22. Migrations and seed behavior

`migrate.ts` finds ordered `.sql` files and applies each once using a ledger table. An advisory lock serializes migration runners. Each file and its ledger insertion use one transaction; failed migration does not get marked applied.

There is no automatic down migration. Forward-only changes are simpler here and avoid dangerous destructive rollback assumptions. Once the project is shared, do not rewrite an applied migration; add the next file.

`seed.ts` skips a database that already contains users. `seed.sql` runs as one transaction, creates five users and a dozen task scenarios, and advances tasks through real transitions so workload and audit records are realistic. Its deadlines are relative to seed time. Restarting the server does not reset reviewers' changes.

The seed is intentionally not a generic data importer. A partially hand-populated database with users will not be completed automatically. For a clean demo, use a fresh disposable database rather than deleting data blindly.

## 23. Local operation and production build

Development uses Vite on 5173 and Express on 3001. `/api` is proxied to the unprefixed backend endpoints. Compose builds TypeScript and React and serves the static React bundle from Express. That gives one local origin and one startup command.

Browser navigation to `/tasks/:id` must return the React page, while `/api/tasks/:id` must return JSON. The server distinguishes HTML browser navigation from API requests before route matching. Static asset serving and client-side routing fallback are included.

The app uses the database container hostname `db` inside Compose and localhost port 5433 on the host. Port 5433 avoids a native local PostgreSQL instance. The Docker volume persists state. Database health determines whether the app starts; migrations and seed run before the server.

The Node production process also handles shutdown signals: close event clients/listener, stop accepting connections, end the pool, and bound shutdown time. Deployment was completed on 11 October 2026 at [https://taskbid-pisc.onrender.com](https://taskbid-pisc.onrender.com), with hosted migrations, seeding, API checks, concurrent assignment, and cross-tab real-time updates verified. See `docs/DEPLOYMENT.md` for the Free-plan limitations and 10 November database expiry.

## 24. What the tests establish

Integration tests start an Express server on an ephemeral local port and use real HTTP plus real PostgreSQL. Fixtures live in a dedicated database ending `_test`; the test runner refuses other names. Each test clears only those disposable fixtures.

The overlapping race test holds the bidder row from a separate connection, starts both assignment requests, waits until database activity shows both blocked on locks, then releases the blocker. It checks one task uses the bidder, the other uses fallback, and workload does not exceed capacity.

Other tests cover no-fallback contention, same-task contention, stale bid fallback, no-winner rollback, invalid bids, pending bids without reservations, stale form submission, closing versus bidding, lifecycle/permissions, completion release, tie ordering, direct SQL bypass attempts, deferred constraints, audit details, dashboard arithmetic, malformed inputs, and SSE commit/rollback semantics.

Browser tests exercise creating a draft, opening bids, bidding from a second browser context, observing the first context update without refresh, closing/assigning, progressing as assignee, approving as creator, chart rendering, mobile overflow, own-task form suppression, and navigation recovery.

These tests prove the implemented scenarios, not unlimited production scalability or cloud compatibility. Database mocks alone would not prove row locking. A screenshot alone would not prove business correctness. Use both behavior and visual checks for their respective purposes.

## 25. Manual demonstration without modifying the seed globally

Start the app and choose Ayesha. Open an existing open task in a second browser session as Maya. Bid 1–2 hours in the second session and watch the first update. Close and assign as Ayesha. Switch to the assignee to start and submit review, then Ayesha to approve done.

For the stale scenario, open “Stale bidder: choose the next user.” Sara has only two free hours but bid three earlier. Assignment should choose Bilal at four. Show the rejected offer and audit entry.

For capacity racing, the deterministic integration test is the clearest repeatable demonstration. It leaves development seed data alone and resets test fixtures each run. Running two seeded assignments repeatedly is not a resettable experiment: after the first success their tasks are assigned. Explain that rather than pretending every request is a fresh auction.

## 26. Questions you should be ready to answer

**Why is a transaction alone insufficient?** It gives atomic commit/rollback but does not automatically prevent two transactions from checking the same stale capacity. We serialize on the shared user row.

**Why task locks and user locks?** Task locks protect one auction's lifecycle and winner; user locks protect capacity shared across auctions.

**Why recheck a bid that was valid when placed?** Capacity changes after placement. Placement eligibility is not a reservation.

**Why use SQL NUMERIC instead of JavaScript numbers for selection?** Exact decimal comparisons avoid binary floating-point errors. Display conversion is acceptable; selecting a winner must be exact.

**Why deferred constraints?** The accepted-bid and task writes are separate valid steps, but their final committed state must agree.

**Why not use SERIALIZABLE everywhere?** Explicit locks protect the known invariants with understandable behavior. SERIALIZABLE is a valid alternative with retry costs, not a magic removal of transaction design.

**Could deadlocks still happen?** Yes, particularly through foreign keys or future writes. Consistent candidate ordering reduces a common cause; bounded whole-transaction retries handle remaining cases.

**Why preserve rejected bids?** They are history and support transparent decisions. Erasing a stale offer would hide the original user action.

**Can audit triggers be bypassed?** Ordinary writes cannot omit actor context or update/delete audit records. An administrator with trigger/DDL/TRUNCATE privileges can bypass protections. Restricted roles are needed for stronger guarantees.

**What happens when SSE disconnects?** EventSource reconnects; ready/resync causes a fresh query. We recover current state without promising durable event history.

**Why are all queries invalidated?** The workspace is small and this is reliable. At scale, target task/bid keys plus affected users/stats and use pagination.

**How do we know the race test overlapped?** It explicitly observes both transactions waiting on locks before releasing the blocker.

**What does remaining weekly capacity mean?** In our documented model it is an active-work ceiling expressed in weekly-hour units. We did not implement calendar-week scheduling or automatic resets.

## 27. Improvements with more time

Prioritize improvements that address actual limitations:

1. Separate restricted runtime and migration database roles; add real authentication and authorized actor context.
2. Introduce calendar-based capacity if the product truly schedules work by week.
3. Add pagination, targeted invalidation, realistic-volume query measurement, and connection tuning.
4. Add cancellation/reassignment with explicit lifecycle and capacity-release semantics.
5. Use an outbox and durable delivery only if notifications must survive downtime and every event matters.
6. Add operational metrics/log correlation and an SSE-capable hosting configuration during deployment.

The optional global assignment optimizer is a different combinatorial problem. Greedily choosing each task's lowest bid is not necessarily globally optimal when tasks compete for capacity. If added, define whether all tasks must be assigned, what happens when that is impossible, and how solution size/time are bounded. We intentionally did not present a greedy heuristic as an exact optimizer.

## 28. A concise explanation in your own words

“I kept the system small and made PostgreSQL the final authority for its shared state. Bids are offers, not capacity reservations. Assignment locks the task and candidate user rows, then chooses the lowest bid that fits the locked current capacity. Task, bid, workload, and audit changes commit together. The frontend validates for usability but handles stale capacity from the server. SSE delivers committed refresh hints, and reconnect refetches current state. The main trade-off is more database logic and conservative locking in exchange for an implementation whose concurrency behavior I can demonstrate with real overlapping transactions.”

Use that as a starting point, then explain the actual code in your own words. Avoid claiming features or production guarantees beyond the verified implementation.

## 29. Verified results and what to do next

The local verification record is in `docs/VERIFICATION.md`: 19 PostgreSQL integration tests, three Chromium browser tests, TypeScript checks, production builds, Docker startup, and compiled-route smoke checks passed. Read that file for the precise scope of those claims.

For review, open the live application and then walk through the schema and assignment code in the reading order above. Run the deterministic race test yourself and explain the shared user lock before changing any concurrency code. Next, review the UI flows and errors, then record the Loom walkthrough using `docs/LOOM_OUTLINE.md`. The app is already deployed and seeded; the original capacity-race and stale-bid seed tasks were preserved during hosted verification. The optional optimizer and outbid-toast feature remain optional scope, rather than hidden unfinished mandatory work.
