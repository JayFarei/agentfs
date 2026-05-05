// Tiny fetch wrapper for the datafetch CLI client.
//
// Resolves the server base URL from `--server <url>` (highest priority),
// then `DATAFETCH_SERVER_URL`, then `http://localhost:8080`. All client
// subcommands talk to a server already running locally; the wrapper
// surfaces structured errors (status + body) back to the caller so the
// CLI can write a clear message to stderr without a stack trace.

const DEFAULT_SERVER_URL = "http://localhost:8080";

export type ServerSource = "flag" | "env" | "default";

export type ServerInfo = {
  baseUrl: string;
  source: ServerSource;
};

export function resolveServerUrl(flagValue?: string): ServerInfo {
  if (flagValue && flagValue.length > 0) {
    return { baseUrl: stripTrailingSlash(flagValue), source: "flag" };
  }
  const env = process.env["DATAFETCH_SERVER_URL"];
  if (env && env.length > 0) {
    return { baseUrl: stripTrailingSlash(env), source: "env" };
  }
  return { baseUrl: DEFAULT_SERVER_URL, source: "default" };
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

export class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export type RequestOpts = {
  method: "GET" | "POST" | "DELETE";
  path: string;
  body?: unknown;
  serverUrl: string;
};

// Hits the server, returns parsed JSON. Throws HttpError with the parsed
// body on non-2xx; throws Error on network failure with a reminder that
// the server may not be running.
export async function jsonRequest<T = unknown>(opts: RequestOpts): Promise<T> {
  const url = `${opts.serverUrl}${opts.path}`;
  const init: RequestInit = { method: opts.method };
  if (opts.body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `request to ${url} failed: ${message}\n` +
        `(is the datafetch server running? try \`datafetch server\`)`,
    );
  }
  const text = await res.text();
  let body: unknown = undefined;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    throw new HttpError(
      res.status,
      body,
      `${opts.method} ${opts.path} failed: ${res.status} ${shortBody(body)}`,
    );
  }
  return body as T;
}

function shortBody(body: unknown): string {
  if (body === undefined) return "";
  if (typeof body === "string") return body.slice(0, 200);
  try {
    return JSON.stringify(body).slice(0, 200);
  } catch {
    return "(unprintable body)";
  }
}
