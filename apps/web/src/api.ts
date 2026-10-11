export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export const apiBase = import.meta.env.VITE_API_URL ?? '/api';
export async function api<T>(
  path: string,
  actor?: string,
  body?: unknown,
  method = 'GET',
): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(actor ? { 'x-user-id': actor } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(
      data.error?.code ?? 'ERROR',
      data.error?.message ?? 'Request failed.',
      response.status,
    );
  return data;
}
