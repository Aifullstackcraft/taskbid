import { useEffect, useState, lazy, Suspense } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutDashboard, Columns3, Radio } from 'lucide-react';
import { type User } from '@taskbid/contracts';
import { api, apiBase } from './api';
import { ErrorBox } from './ui';
import { Board } from './features/Board';
import { Detail } from './features/Detail';
const Dashboard = lazy(() =>
  import('./features/Dashboard').then((module) => ({ default: module.Dashboard })),
);
export function App() {
  const client = useQueryClient(),
    users = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });
  const [actor, setActor] = useState(() => localStorage.getItem('taskbid-user') ?? ''),
    [connected, setConnected] = useState(false);
  const active = users.data?.find((u) => u.id === actor) ?? users.data?.[0];
  const userId = active?.id ?? '';
  useEffect(() => {
    const stream = new EventSource(`${apiBase}/events`);
    const refresh = () => void client.invalidateQueries();
    stream.addEventListener('ready', () => {
      setConnected(true);
      refresh();
    });
    stream.addEventListener('resync', refresh);
    stream.addEventListener('change', refresh);
    stream.onerror = () => setConnected(false);
    stream.onopen = () => setConnected(true);
    return () => stream.close();
  }, [client]);
  return (
    <div className="app">
      <aside>
        <Link className="brand" to="/">
          <span className="brand-mark">t.</span>taskbid<span className="brand-dot">●</span>
        </Link>
        <div className="workspace">
          WORKSPACE<span>Product & engineering</span>
        </div>
        <nav>
          <NavLink to="/" end>
            <Columns3 size={18} />
            Task board
          </NavLink>
          <NavLink to="/dashboard">
            <LayoutDashboard size={18} />
            Dashboard
          </NavLink>
        </nav>
        <div className="sidebar-note">
          <span className="eyebrow">A BETTER WAY TO SHARE WORK</span>
          <p>
            Find the right task.
            <br />
            Make room for great work.
          </p>
        </div>
        <div className="connection">
          <Radio size={14} />
          {connected ? 'Live updates connected' : 'Reconnecting live updates…'}
        </div>
      </aside>
      <div className="main">
        <header>
          <span>
            Team workspace <span className="slash">/</span> Task marketplace
          </span>
          <label className="switcher">
            Viewing as
            <select
              aria-label="Current user"
              value={userId}
              onChange={(e) => {
                setActor(e.target.value);
                localStorage.setItem('taskbid-user', e.target.value);
              }}
            >
              {users.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        </header>
        <ErrorBox error={users.error} />
        {active && (
          <Routes>
            <Route path="/" element={<Board user={active} />} />
            <Route path="/tasks/:id" element={<Detail user={active} />} />
            <Route
              path="/dashboard"
              element={
                <Suspense fallback={<p className="loading">Loading dashboard…</p>}>
                  <Dashboard />
                </Suspense>
              }
            />
            <Route
              path="*"
              element={
                <section className="page">
                  <h1>Page not found</h1>
                  <Link to="/">Return to the board</Link>
                </section>
              }
            />
          </Routes>
        )}
        {users.isPending && <p className="loading">Loading your workspace…</p>}
      </div>
    </div>
  );
}
