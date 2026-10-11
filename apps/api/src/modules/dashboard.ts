import { pool } from '../db/pool.ts';
export async function dashboardStats() {
  const result = await pool.query(`WITH status_counts AS (
 SELECT s.status,count(t.id)::int count FROM unnest(ARRAY['draft','open','bidding_closed','assigned','in_progress','review','done']) WITH ORDINALITY s(status,position)
 LEFT JOIN tasks t ON t.status=s.status GROUP BY s.status,s.position ORDER BY s.position
 ), averages AS (
 SELECT c.complexity,round(avg(b.hours),2)::float8 average_hours FROM generate_series(1,5) c(complexity)
 LEFT JOIN tasks t ON t.complexity=c.complexity LEFT JOIN bids b ON b.task_id=t.id GROUP BY c.complexity ORDER BY c.complexity
 ), leaders AS (
 SELECT u.id,u.name,count(*)::int completed FROM tasks t JOIN users u ON u.id=t.assignee_id WHERE t.status='done'
 GROUP BY u.id,u.name ORDER BY completed DESC,u.name,u.id LIMIT 3
 ), overdue AS (
 SELECT t.id,t.title,t.deadline FROM tasks t WHERE t.deadline<now() AND NOT EXISTS(SELECT 1 FROM bids b WHERE b.task_id=t.id) ORDER BY t.deadline
 ) SELECT jsonb_build_object(
 'by_status',COALESCE((SELECT jsonb_agg(status_counts) FROM status_counts),'[]'::jsonb),
 'average_by_complexity',COALESCE((SELECT jsonb_agg(averages) FROM averages),'[]'::jsonb),
 'top_users',COALESCE((SELECT jsonb_agg(leaders) FROM leaders),'[]'::jsonb),
 'overdue_without_bids',COALESCE((SELECT jsonb_agg(overdue) FROM overdue),'[]'::jsonb)) stats`);
  return result.rows[0].stats;
}
