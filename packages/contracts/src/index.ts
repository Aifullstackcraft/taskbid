export const statuses = [
  'draft',
  'open',
  'bidding_closed',
  'assigned',
  'in_progress',
  'review',
  'done',
] as const;
export type TaskStatus = (typeof statuses)[number];
export interface User {
  id: string;
  name: string;
  email: string;
  hourly_rate: string;
  current_workload: string;
  max_capacity: string;
  remaining_capacity: string;
}
export interface Task {
  id: string;
  title: string;
  description: string;
  complexity: number;
  status: TaskStatus;
  created_by: string;
  creator_name: string;
  deadline: string;
  assignee_id: string | null;
  assignee_name: string | null;
  accepted_hours: string | null;
  bid_count: number;
  lowest_bid: string | null;
}
export interface Bid {
  id: string;
  task_id: string;
  user_id: string;
  user_name: string;
  hours: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  currently_eligible: boolean;
}
export interface AuditEntry {
  id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  actor_id: string;
  actor_name: string | null;
  changed_at: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
}
export interface Stats {
  by_status: { status: TaskStatus; count: number }[];
  average_by_complexity: { complexity: number; average_hours: number | null }[];
  top_users: { id: string; name: string; completed: number }[];
  overdue_without_bids: { id: string; title: string; deadline: string }[];
}
