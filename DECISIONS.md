# Implementation decisions

## Architecture

One React app, one Express process, one PostgreSQL database. A single repository with npm workspaces allows shared API types and one lockfile. PostgreSQL contains invariants; Express coordinates permissions, validation, transactions, and response shapes; React handles presentation and stale-data recovery. No dependency injection framework or generic repository hierarchy is needed at this scale.

## Database access

Use `pg` and visible parameterized SQL. Full ORMs are excluded by the specification; a query builder would be allowed but offers limited benefit for these few explicit queries. Numbered migrations are hand-written SQL. The migration runner uses an advisory lock so concurrent runners cannot apply one migration twice. Each migration and its ledger entry commit together. Existing migration files should never be edited after publication; create the next numbered migration instead.

## A: Locking and atomicity

Default READ COMMITTED with explicit row locks is sufficient because all capacity-changing writes serialize on user rows. All task changes first lock the task. Assignment locks all pending bidders in consistent UUID order, then re-queries eligibility using exact PostgreSQL NUMERIC arithmetic. Locking all candidates is deliberately conservative: it simplifies deterministic winner selection and avoids opposite-ranked user-lock cycles at the cost of blocking some unrelated assignments.

Alternatives: SERIALIZABLE with retries; a conditional `UPDATE users ... WHERE workload + hours <= max_capacity RETURNING ...`; or a database assignment function. Conditional updates can protect capacity efficiently but require equally careful task coordination and auditing. SERIALIZABLE can protect more complex predicate invariants but is not an excuse to omit retries. An in-memory mutex fails across processes. `SKIP LOCKED` could skip the true lowest bidder merely because they are temporarily busy; that changes selection semantics.

Deadlocks remain possible through less obvious foreign-key locks or future mutation paths. Retry only known transaction-level retryable SQLSTATEs (`40P01`, `40001`), from the start, with bounded jitter. Lock and statement timeouts prevent indefinitely occupied connections. After exhaustion, report a transient failure rather than guessing success.

## Workload ownership

Users store a workload counter for a simple row-local capacity constraint and fast reads. Task transition triggers increment on assignment and decrement on completion. Direct counter edits are blocked. The aggregate of accepted active task hours is the business meaning of this counter. The accepted bid and task assignment are checked by deferred constraints. A computed workload view would avoid a stored counter but still need a common user lock before recomputing capacity and committing assignments; otherwise different task rows allow write skew.

## B: Stale bids

Pending bids do not reserve capacity. Placement checks current eligibility, and assignment checks again under locks. Skip bidders that no longer fit. Preserve the bid and its original offer. On successful assignment, nonwinning pending bids become rejected; with no winner, leave the closed task and pending bids unchanged. There is no automatic reopening because the lifecycle forbids backwards transitions.

## C: Dashboard

Use one SQL statement with four independent aggregate CTEs and JSON assembly. It reduces round trips and ensures one snapshot, without introducing the duplicate-count problem from joining tasks and bids before counting tasks. Use `NOT EXISTS` for no-bid tasks, all seven generated statuses for zero-count groups, and all five complexity levels for consistent charts. The average includes every recorded bid, because the requested metric is bid amount, not winning amount.

## D: Audit

Database AFTER triggers capture full previous/new snapshots for task and bid INSERT/UPDATE. Transaction-local actor context is mandatory. Records are append-only for ordinary UPDATE/DELETE statements; task/bid deletes are rejected because no deletion lifecycle is defined. The trigger also sends a transactional PostgreSQL notification containing a task ID and entity type, not the full record. Triggers cover direct SQL writes and naturally roll back. Costs are database coupling, storage growth, and requiring explicit actor context in scripts. Application middleware would be easier to read but can miss direct database writes and complex multi-statement changes.

## Real-time delivery

SSE is sufficient for one-way updates. REST remains the mutation protocol. PostgreSQL notifications allow separate Express instances to hear committed writes; one dedicated session connection listens and reconnects. SSE does not provide persistent history or exactly-once delivery. Reconnect triggers query refresh, recovering current state. All query caches are invalidated for this small workspace; targeted invalidation is a scaling improvement.

## Identity and lifecycle

Simulated identity arrives through `x-user-id`, not a login. Creator controls draft/open/closed, assignment, and final approval. Assignee controls starting/submitting work. No real security boundary is claimed. Task lifecycle advances exactly one stage. Assignment is a special transition through `/assign`; generic status changes cannot invent an assignee. A repeated assignment is a conflict, not silent idempotent success.

## Numeric values and deadline

Hours and rates use NUMERIC with two decimal places. API rejects fractional precision above two decimal places. Capacity winner selection uses SQL arithmetic, avoiding JavaScript floating-point edge cases. API numeric values from PostgreSQL are represented as strings unless explicitly cast for a chart/count. Deadline uses `timestamptz` and is a task completion deadline, not an auction cutoff. The frontend formats it in the viewer's timezone. Expired open tasks can still receive bids until explicitly closed.

## Scope and alternatives

No calendar reset, actual-time tracking, bid editing, reassignment, deletion, pagination, global assignment optimization, durable message queue, real authentication, or outbid notifications. This keeps the mandatory workflow explainable within the assignment's time budget. The concurrency integration test is included even though the assignment calls it optional: it is the most useful evidence for the core correctness claim. Deployment was completed on 11 October 2026 using a combined Render Free web service and separate Free PostgreSQL database. The human recording remains pending. See the deployment guide for the live URL and expiry.
