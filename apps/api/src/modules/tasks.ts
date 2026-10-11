import type { PoolClient } from 'pg';
import { AppError } from '../errors.ts';
import { pool, transaction } from '../db/pool.ts';
export const taskSelect = `SELECT t.*,creator.name creator_name,assignee.name assignee_name,
 (SELECT count(*)::int FROM bids b WHERE b.task_id=t.id) bid_count,
 (SELECT min(hours)::text FROM bids b WHERE b.task_id=t.id) lowest_bid
 FROM tasks t JOIN users creator ON creator.id=t.created_by LEFT JOIN users assignee ON assignee.id=t.assignee_id`;
export async function getTask(id: string, client: PoolClient | typeof pool = pool) {
  const result = await client.query(`${taskSelect} WHERE t.id=$1`, [id]);
  if (!result.rows[0]) throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found.');
  return result.rows[0];
}
export async function lockTask(client: PoolClient, id: string) {
  const result = await client.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE', [id]);
  if (!result.rows[0]) throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found.');
  return result.rows[0];
}
export function requireCreator(task: { created_by: string }, actor: string) {
  if (task.created_by !== actor)
    throw new AppError(403, 'FORBIDDEN', 'Only the task creator can perform this action.');
}
export async function assignTask(id: string, actor: string) {
  return transaction(actor, async (client) => {
    const task = await lockTask(client, id);
    requireCreator(task, actor);
    if (task.status !== 'bidding_closed')
      throw new AppError(
        409,
        'TASK_NOT_ASSIGNABLE',
        'Close bidding before assignment. Assigned tasks cannot be assigned again.',
      );
    const bids = await client.query(
      "SELECT * FROM bids WHERE task_id=$1 AND status='pending' ORDER BY hours,created_at,id",
      [id],
    );
    // Lock all candidates in UUID order, rather than ranking order, to prevent cycles.
    await client.query('SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [
      bids.rows.map((b) => b.user_id),
    ]);
    // Compare exact NUMERIC values in SQL; JavaScript floating-point sums can reject a valid decimal bid.
    const winner = (
      await client.query(
        `SELECT b.* FROM bids b JOIN users u ON u.id=b.user_id
 WHERE b.task_id=$1 AND b.status='pending' AND u.current_workload+b.hours<=u.max_capacity
 ORDER BY b.hours,b.created_at,b.id LIMIT 1`,
        [id],
      )
    ).rows[0];
    if (!winner)
      throw new AppError(
        409,
        'NO_ELIGIBLE_BIDDER',
        'No bidder currently has sufficient capacity. The task remains closed.',
      );
    await client.query(
      "UPDATE bids SET status=CASE WHEN id=$2 THEN 'accepted' ELSE 'rejected' END WHERE task_id=$1 AND status='pending'",
      [id, winner.id],
    );
    await client.query(
      "UPDATE tasks SET status='assigned',assignee_id=$2,accepted_hours=$3 WHERE id=$1",
      [id, winner.user_id, winner.hours],
    );
    return getTask(id, client);
  });
}
