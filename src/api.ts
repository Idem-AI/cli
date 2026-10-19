/**
 * The iDeploy API, as the CLI uses it. Every answer is `{ success, data }` or
 * `{ success: false, error: { code, message } }`; errors carry the API's own
 * message, meant to be shown as is.
 */
import { apiUrl, token } from './config.js';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  /** false: a public route (sign-in). */
  auth?: boolean;
  /** This token instead of the saved one (checking a token before saving it). */
  token?: string;
}

export async function request<T>(method: Method, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'idem-cli' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false) {
    const t = opts.token ?? token();
    if (!t) throw new ApiError('You are not signed in. Run `idem login`.', 401, 'NOT_SIGNED_IN');
    headers.Authorization = `Bearer ${t}`;
  }
  let response: Response;
  try {
    response = await fetch(`${apiUrl()}/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new ApiError(`iDeploy cannot be reached (${apiUrl()}): ${(err as Error).message}`, 0, 'NETWORK');
  }
  const text = await response.text();
  let json: { success?: boolean; data?: T; error?: { code?: string; message?: string } } = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* not JSON: a proxy page */
  }
  if (!response.ok || json.success === false) {
    if (response.status === 401) {
      throw new ApiError('Your session has expired or was revoked. Run `idem login`.', 401, 'UNAUTHORIZED');
    }
    const message = json.error?.message || `iDeploy answered ${response.status}${text && !json.error ? `: ${text.slice(0, 200)}` : ''}`;
    throw new ApiError(message, response.status, json.error?.code ?? null);
  }
  return json.data as T;
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', path, body ?? {}, opts),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

// ── What the CLI reads ────────────────────────────────────────────────────────

export interface Me {
  id: number;
  name: string;
  email: string;
  team: { id: number; name: string } | null;
}

export interface Workspace {
  uuid: string;
  name: string;
}

export interface Application {
  uuid: string;
  name: string;
  status?: string | null;
  fqdn?: string | null;
  /** Where it answers, computed by the API. */
  link?: string | null;
  workspace_name?: string | null;
  workspace_uuid?: string | null;
  git_repository?: string | null;
  build_pack?: string | null;
  updated_at?: string | null;
}

export interface Deployment {
  deployment_uuid: string;
  status: string;
  logs: string | null;
  application_uuid: string;
  application_name: string;
  application_url: string | null;
  created_at?: string;
  commit?: string | null;
}

export interface EnvVar {
  key: string;
  value: string;
}
