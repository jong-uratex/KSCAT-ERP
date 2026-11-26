import type { PermissionAction, PermissionMap, PermissionModule } from '../types/erp';

// Session Bearer token held strictly in JS memory (never localStorage or sessionStorage)
let inMemoryToken: string | null = null;
let onUnauthorizedCallback: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  inMemoryToken = token;
}

export function getAuthToken(): string | null {
  return inMemoryToken;
}

export function setUnauthorizedHandler(cb: () => void): void {
  onUnauthorizedCallback = cb;
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path) || !API_BASE_URL) {
    return path;
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    skipAuthCheck?: boolean;
  } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (inMemoryToken) {
    headers.Authorization = `Bearer ${inMemoryToken}`;
  }

  const res = await fetch(resolveApiUrl(path), {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/html')) {
    throw new Error(
      'Backend API returned HTML instead of JSON. Configure API_ORIGIN in Cloudflare Pages or VITE_API_BASE_URL to point to your KSCAT-ERP server.'
    );
  }

  const data = await res.json().catch(() => ({}));

  if (res.status === 401 && !options.skipAuthCheck && onUnauthorizedCallback) {
    inMemoryToken = null;
    onUnauthorizedCallback();
  }

  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }

  return data as T;
}

export function can(
  permissions: PermissionMap | null | undefined,
  module: PermissionModule,
  action: PermissionAction
): boolean {
  if (!permissions) return false;
  const actions = permissions[module];
  return Array.isArray(actions) && actions.includes(action);
}
