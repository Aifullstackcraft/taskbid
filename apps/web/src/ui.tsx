export const label = (s: string) => s.replaceAll('_', ' ');
export const date = (s: string) =>
  new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const number = (s: string | number | null) =>
  s === null ? '—' : Number(s).toLocaleString(undefined, { maximumFractionDigits: 2 });
export function ErrorBox({ error }: { error: Error | null }) {
  return error ? (
    <div className="error" role="alert">
      {error.message}
    </div>
  ) : null;
}
