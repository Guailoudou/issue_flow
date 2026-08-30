export class ApiError extends Error {
  constructor(public status: number, message: string, public code = 'UNKNOWN', public requestId?: string) { super(message); }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${path}`, { ...init, headers, credentials: 'include' });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.error;
    throw new ApiError(response.status, detail?.message || '请求失败，请稍后重试', detail?.code, detail?.requestId);
  }
  if (payload && typeof payload === 'object' && payload.pagination) Object.assign(payload, payload.pagination);
  return payload as T;
}

export const jsonBody = (value: unknown): RequestInit => ({ body: JSON.stringify(value) });
export function queryString(values: Record<string, string | number | boolean | undefined | null>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '') params.set(key, String(value)); });
  const text = params.toString();
  return text ? `?${text}` : '';
}
