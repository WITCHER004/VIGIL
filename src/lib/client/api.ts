/**
 * Browser-side API client. Mirrors the server's `{ error: { code, message, details } }`
 * envelope so components can show precise messages (e.g. SSRF rejections).
 */

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }

  /** Field → message map for Zod validation failures. */
  get fieldErrors(): Record<string, string> {
    if (this.code !== "VALIDATION_FAILED" || !Array.isArray(this.details)) return {};
    const out: Record<string, string> = {};
    for (const d of this.details as { path: string; message: string }[]) out[d.path] ??= d.message;
    return out;
  }
}

export interface ApiFetchInit extends Omit<RequestInit, "body"> {
  json?: unknown;
  /** Background calls (live polling) set this so a 401 never pops the unlock modal. */
  quietAuth?: boolean;
}

/** Window event the app shell listens for to open the Operator Session Unlock modal. */
export const OPERATOR_REQUIRED_EVENT = "vigil:operator-required";

export async function apiFetch<T>(path: string, { json, headers, quietAuth, ...init }: ApiFetchInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { Accept: "application/json", ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    // A user action hit an operator-only route: ask the shell to offer the unlock modal.
    if (res.status === 401 && !quietAuth && path !== "/api/auth/operator" && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(OPERATOR_REQUIRED_EVENT));
    }
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiClientError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? res.statusText, err?.details, data);
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
