import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { ArrowRight } from 'lucide-react';
import { type Stats } from '@taskbid/contracts';
import { api } from '../api';
import { label, date, ErrorBox } from '../ui';
export function Dashboard() {
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api<Stats>('/dashboard/stats') });
  if (stats.isPending) return <p className="loading">Loading team insights…</p>;
  if (!stats.data)
    return (
      <section className="page">
        <ErrorBox error={stats.error} />
      </section>
    );
  const s = stats.data;
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">THE BIG PICTURE</span>
          <h1>Team dashboard</h1>
          <p>A clear view of work, effort, and delivery.</p>
        </div>
        <span className="snapshot">Live workspace snapshot</span>
      </div>
      <div className="stats-grid">
        {[
          { label: 'Total tasks', value: s.by_status.reduce((n, x) => n + x.count, 0) },
          {
            label: 'Open for bidding',
            value: s.by_status.find((x) => x.status === 'open')?.count ?? 0,
          },
          { label: 'Completed', value: s.by_status.find((x) => x.status === 'done')?.count ?? 0 },
          { label: 'Overdue without bids', value: s.overdue_without_bids.length },
        ].map((x) => (
          <div className="stat" key={x.label}>
            <span>{x.label}</span>
            <strong>{x.value}</strong>
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        <article className="panel">
          <h2>Average bid by complexity</h2>
          <p className="muted">Offered hours across all bids, including historical bids.</p>
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={s.average_by_complexity}
                margin={{ left: 12, right: 16, bottom: 25, top: 12 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="complexity"
                  label={{ value: 'Task complexity (1–5)', position: 'bottom' }}
                />
                <YAxis label={{ value: 'Average hours', angle: -90, position: 'insideLeft' }} />
                <Tooltip formatter={(v) => [`${v} hrs`, 'Average bid']} />
                <Bar dataKey="average_hours" fill="#28745b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <small className="muted">
            Source: current PostgreSQL task and bid records. A missing bar means no bids at that
            complexity.
          </small>
        </article>
        <article className="panel">
          <h2>Work by stage</h2>
          <div className="stage-list">
            {s.by_status.map((x) => (
              <div key={x.status}>
                <span>
                  <i className={`status-dot ${x.status}`} />
                  {label(x.status)}
                </span>
                <strong>{x.count}</strong>
              </div>
            ))}
          </div>
        </article>
        <article className="panel">
          <h2>Top contributors</h2>
          <p className="muted">Ranked by tasks completed as assignee.</p>
          {s.top_users.length ? (
            s.top_users.map((u, i) => (
              <div className="leader" key={u.id}>
                <span className="rank">{i + 1}</span>
                <strong>{u.name}</strong>
                <span>{u.completed} completed</span>
              </div>
            ))
          ) : (
            <p className="empty">Completed tasks will appear here.</p>
          )}
        </article>
        <article className="panel">
          <h2>Needs attention</h2>
          <p className="muted">Past the deadline, with no bids received.</p>
          {s.overdue_without_bids.length ? (
            s.overdue_without_bids.map((t) => (
              <Link className="attention" to={`/tasks/${t.id}`} key={t.id}>
                <span>
                  {t.title}
                  <small>Due {date(t.deadline)}</small>
                </span>
                <ArrowRight size={16} />
              </Link>
            ))
          ) : (
            <p className="empty">No overdue tasks without bids.</p>
          )}
        </article>
      </div>
    </section>
  );
}
