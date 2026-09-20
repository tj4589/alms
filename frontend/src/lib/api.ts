import { getToken, clearToken } from './session';
const LOCAL_API_BASE_URL = 'http://127.0.0.1:8001';
const PRODUCTION_API_BASE_URL = 'https://exammind-api.onrender.com';
const isProductionRenderSite = typeof window !== 'undefined' && window.location.hostname === 'exammind-web.onrender.com';
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || (isProductionRenderSite ? PRODUCTION_API_BASE_URL : LOCAL_API_BASE_URL)).replace(/\/+$/, '');

export const BACKEND_CONNECTION_ERROR = isProductionRenderSite
  ? 'ExamMind could not reach its live API. Please try again shortly.'
  : `Cannot connect to backend. Start FastAPI and confirm VITE_API_BASE_URL matches the running backend. Try ${LOCAL_API_BASE_URL}/docs.`;

type RequestBody = Record<string, unknown> | unknown[];

export function getAuthToken() {
  return getToken();
}

export function clearAuthToken() {
  clearToken();
}

async function readErrorMessage(response: Response, fallback: string) {
  try {
    const data = await response.json();
    return sanitizeErrorMessage(data.detail || fallback);
  } catch {
    return fallback;
  }
}

function sanitizeErrorMessage(message: string) {
  const text = String(message || '');
  const lowered = text.toLowerCase();
  if (lowered.includes('402') || lowered.includes('insufficient balance')) {
    return 'AI provider balance is currently unavailable. Search and uploaded materials are still working, but live AI answers require a valid API balance.';
  }
  if (
    lowered.includes('deepseek') ||
    lowered.includes('cohere') ||
    lowered.includes('provider error')
  ) {
    return 'The primary AI provider is temporarily unavailable. ExamMind tried the fallback provider.';
  }
  return text;
}

async function request(path: string, init: RequestInit, fallbackError: string) {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, init);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(BACKEND_CONNECTION_ERROR);
    }
    throw error;
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, fallbackError));
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function authHeaders(extraHeaders: HeadersInit = {}) {
  const token = getAuthToken();
  return {
    ...extraHeaders,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function apiGet(path: string) {
  return request(path, { method: 'GET', headers: authHeaders() }, 'Request failed.');
}

export function apiPost(path: string, body: RequestBody) {
  return request(
    path,
    {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    },
    'Request failed.',
  );
}

export function apiDelete(path: string, body?: RequestBody) {
  return request(
    path,
    {
      method: 'DELETE',
      headers: authHeaders(body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    },
    'Delete request failed.',
  );
}

export function apiFormPost(path: string, formData: FormData | URLSearchParams) {
  const isUrlEncoded = formData instanceof URLSearchParams;
  return request(
    path,
    {
      method: 'POST',
      headers: authHeaders(isUrlEncoded ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      body: formData,
    },
    'Request failed.',
  );
}

/**
 * Download a file the backend serves behind auth.
 *
 * A plain <a href> cannot carry the bearer token, so the bytes are fetched,
 * handed to the browser as a blob, and the object URL is revoked once the
 * click has been dispatched. Returns the filename the server chose, so the
 * caller can say what was saved.
 */
export async function apiDownload(path: string, fallbackName: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}${path}`, { method: 'GET', headers: authHeaders() });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'That file could not be downloaded.'));
  }

  // The server names the file in Content-Disposition; fall back to the
  // caller's name when the header is absent or unparseable.
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const filename = match ? match[1] : fallbackName;

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return filename;
}
