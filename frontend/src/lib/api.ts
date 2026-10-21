import { getToken, clearToken } from './session';
import { parseJsonBody, sanitizeErrorMessage } from './apiResponse';
const LOCAL_API_BASE_URL = 'http://127.0.0.1:8001';
const PRODUCTION_API_BASE_URL = 'https://exammind-api.onrender.com';
const isProductionRenderSite = typeof window !== 'undefined' && window.location.hostname === 'exammind-web.onrender.com';
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || (isProductionRenderSite ? PRODUCTION_API_BASE_URL : LOCAL_API_BASE_URL)).replace(/\/+$/, '');

export const BACKEND_CONNECTION_ERROR = isProductionRenderSite
  ? 'ExamMind could not reach its live API. Please try again shortly.'
  : `Cannot connect to backend. Start FastAPI and confirm VITE_API_BASE_URL matches the running backend. Try ${LOCAL_API_BASE_URL}/docs.`;

type RequestBody = Record<string, unknown> | unknown[];
type JsonResponse = Awaited<ReturnType<Response['json']>>;

export type ApiRequestOptions = {
  timeoutMs?: number;
};

export const API_REQUEST_TIMEOUT_ERROR = 'ExamMind is taking too long to respond. Please try again.';
export const API_INVALID_RESPONSE_ERROR = 'ExamMind received an invalid response from the server. Please try again.';

export class ApiHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiHttpError';
    this.status = status;
  }
}

export function getAuthToken() {
  return getToken();
}

export function clearAuthToken() {
  clearToken();
}

export function apiUrl(path: string) {
  return `${API_BASE_URL}${path}`;
}

async function readErrorMessage(response: Response, fallback: string) {
  const data = await readJsonBody(response);
  if (data && typeof data === 'object' && 'detail' in data) {
    const detail = (data as { detail?: unknown }).detail;
    return sanitizeErrorMessage(typeof detail === 'string' ? detail : fallback);
  }
  return fallback;
}

async function readJsonBody(response: Response): Promise<unknown | null> {
  return parseJsonBody(await response.text());
}

async function request(
  path: string,
  init: RequestInit,
  fallbackError: string,
  options: ApiRequestOptions = {},
): Promise<JsonResponse | null> {
  const controller = options.timeoutMs ? new AbortController() : null;
  const timeoutId = controller ? window.setTimeout(() => controller.abort(), options.timeoutMs) : null;
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, controller ? { ...init, signal: controller.signal } : init);
  } catch (error) {
    if (controller?.signal.aborted) {
      throw new Error(API_REQUEST_TIMEOUT_ERROR);
    }
    if (error instanceof TypeError) {
      throw new Error(BACKEND_CONNECTION_ERROR);
    }
    throw error;
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new ApiHttpError(await readErrorMessage(response, fallbackError), response.status);
  }

  if (response.status === 204) {
    return null;
  }

  const data = await readJsonBody(response);
  if (data === null) {
    throw new Error(API_INVALID_RESPONSE_ERROR);
  }
  return data as JsonResponse;
}

function authHeaders(extraHeaders: HeadersInit = {}) {
  const token = getAuthToken();
  return {
    ...extraHeaders,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function apiGet(path: string, options?: ApiRequestOptions) {
  return request(path, { method: 'GET', headers: authHeaders() }, 'Request failed.', options);
}

export function apiPublicGet(path: string, options?: ApiRequestOptions) {
  return request(path, { method: 'GET' }, 'Request failed.', options);
}

export function apiPost(path: string, body: RequestBody, options?: ApiRequestOptions) {
  return request(
    path,
    {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    },
    'Request failed.',
    options,
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

export type ApiProgressEvent = {
  key: string;
  status: string;
};

/**
 * Read an NDJSON response whose progress records are emitted by the server
 * while a long-running form upload is processed. Older API deployments can
 * still return the normal JSON response; that fallback keeps the client
 * compatible during a rolling deploy.
 */
export async function apiFormPostStream(
  path: string,
  formData: FormData | URLSearchParams,
  onProgress: (event: ApiProgressEvent) => void,
) {
  const isUrlEncoded = formData instanceof URLSearchParams;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: authHeaders(isUrlEncoded ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    body: formData,
  });

  if (!response.ok) {
    // The stream endpoint is additive. If a static frontend reaches an API
    // that has not rolled forward yet, use the established JSON endpoint.
    if (response.status === 404 && path.endsWith('/stream')) {
      return apiFormPost(path.slice(0, -'/stream'.length), formData);
    }
    throw new ApiHttpError(await readErrorMessage(response, 'Request failed.'), response.status);
  }

  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('ndjson') || !response.body) {
    const data = await readJsonBody(response);
    if (data === null) throw new Error(API_INVALID_RESPONSE_ERROR);
    return data as JsonResponse;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: unknown = null;

  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error(API_INVALID_RESPONSE_ERROR);
    }
    if (!event || typeof event !== 'object') throw new Error(API_INVALID_RESPONSE_ERROR);
    const record = event as { type?: unknown; key?: unknown; status?: unknown; data?: unknown; detail?: unknown; status_code?: unknown };
    if (record.type === 'progress' && typeof record.key === 'string' && typeof record.status === 'string') {
      onProgress({ key: record.key, status: record.status });
      return;
    }
    if (record.type === 'result') {
      result = record.data;
      return;
    }
    if (record.type === 'error') {
      const detail = typeof record.detail === 'string' ? record.detail : 'Request failed.';
      throw new ApiHttpError(sanitizeErrorMessage(detail), typeof record.status === 'number' ? record.status : 500);
    }
    throw new Error(API_INVALID_RESPONSE_ERROR);
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    lines.forEach(consumeLine);
    if (done) break;
  }
  if (buffer.trim()) consumeLine(buffer);
  if (result === null) throw new Error(API_INVALID_RESPONSE_ERROR);
  return result as JsonResponse;
}

/**
 * Download a file the backend serves behind auth.
 *
 * A plain <a href> cannot carry the bearer token, so the bytes are fetched,
 * handed to the browser as a blob, and the object URL is revoked once the
 * click has been dispatched. Returns the filename the server chose, so the
 * caller can say what was saved.
 */
async function downloadResponse(path: string, init: RequestInit, fallbackName: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}${path}`, init);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'That file could not be downloaded.'));
  }

  // The server names the file in Content-Disposition; fall back to the
  // caller's name when the header is absent or unparseable.
  const disposition = response.headers.get('Content-Disposition') || '';
  const encodedMatch = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const plainMatch = /filename="?([^";]+)"?/i.exec(disposition);
  const sanitizeFilename = (value: string, fallback: string) => {
    const sanitized = [...value]
      .filter(character => {
        const code = character.charCodeAt(0);
        return character !== '\\' && character !== '/' && code >= 32 && code !== 127;
      })
      .join('')
      .trim();
    return sanitized || fallback;
  };
  const safeFallbackName = sanitizeFilename(fallbackName, 'download');
  let filename = safeFallbackName;
  if (encodedMatch) {
    try { filename = decodeURIComponent(encodedMatch[1]); } catch { filename = safeFallbackName; }
  } else if (plainMatch) {
    filename = plainMatch[1];
  }
  filename = sanitizeFilename(filename, safeFallbackName);

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

export function apiDownload(path: string, fallbackName: string): Promise<string> {
  return downloadResponse(path, { method: 'GET', headers: authHeaders() }, fallbackName);
}

export function apiDownloadPost(path: string, body: RequestBody, fallbackName: string): Promise<string> {
  return downloadResponse(
    path,
    {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    },
    fallbackName,
  );
}

export async function apiBlob(path: string): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}${path}`, { method: 'GET', headers: authHeaders() });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'That preview could not be opened.'));
  }
  return response.blob();
}

export function apiPut(path: string, body: RequestBody) {
  return request(
    path,
    {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    },
    'Request failed.',
  );
}

export function apiPatch(path: string, body: RequestBody) {
  return request(
    path,
    {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    },
    'Request failed.',
  );
}
