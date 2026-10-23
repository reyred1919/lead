export const SESSION_EXPIRED_EVENT = "expo:session-expired";

export class ApiError extends Error {
  status: number;
  data: any;
  code?: string;
  constructor(status: number, data: any) {
    super(extractMessage(data) || (status === 0 ? "ارتباط با سرور برقرار نشد." : `خطای ${status}`));
    this.status = status;
    this.data = data;
    this.code = data?.code;
  }
  get isNetwork() {
    return this.status === 0;
  }
  get isConflict() {
    return this.status === 409;
  }
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (this.data && typeof this.data === "object") {
      for (const [k, v] of Object.entries(this.data)) {
        if (k === "detail" || k === "code") continue;
        out[k] = Array.isArray(v) ? String(v[0]) : typeof v === "object" ? JSON.stringify(v) : String(v);
      }
    }
    return out;
  }
}

function extractMessage(data: any): string {
  if (!data) return "";
  if (typeof data === "string") return data.slice(0, 200);
  if (data.detail) return String(data.detail);
  const first = Object.values(data)[0];
  if (Array.isArray(first)) return String(first[0]);
  if (typeof first === "string") return first;
  return "";
}

function csrfToken() {
  const m = document.cookie.match(/(?:^|; )csrftoken=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

export async function ensureCsrf() {
  if (!csrfToken()) await fetch("/api/v1/auth/csrf", { credentials: "same-origin" });
}

type Opts = { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal };

export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const method = opts.method ?? (opts.body || opts.form ? "POST" : "GET");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method !== "GET") {
    await ensureCsrf();
    headers["X-CSRFToken"] = csrfToken();
  }
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { method, headers, body, credentials: "same-origin", signal: opts.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, null);
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    // 401 = no valid session (expired/logged out elsewhere). Let the auth layer redirect to login (QA-D-04).
    if (res.status === 401 && !path.startsWith("/auth/login") && !path.startsWith("/auth/me")) {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    }
    throw new ApiError(res.status, data);
  }
  return data as T;
}

export const get = <T = any>(p: string, signal?: AbortSignal) => api<T>(p, { signal });
export const post = <T = any>(p: string, body?: unknown) => api<T>(p, { method: "POST", body: body ?? {} });
export const patch = <T = any>(p: string, body: unknown) => api<T>(p, { method: "PATCH", body });
export const put = <T = any>(p: string, body: unknown) => api<T>(p, { method: "PUT", body });
export const del = <T = any>(p: string) => api<T>(p, { method: "DELETE" });

export function qs(params: Record<string, unknown>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) continue;
    s.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  const out = s.toString();
  return out ? `?${out}` : "";
}

export type Page<T> = { count: number; next: string | null; previous: string | null; results: T[] };
