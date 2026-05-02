import type {
  StateResponse,
  RunRequest,
  RunResponse,
  EndorseRequest,
  EndorseResponse,
  ResetResponse,
  TenantId,
} from "@server/types";

const base = "/api";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

function withTenant(path: string, tenant: TenantId): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}tenant=${encodeURIComponent(tenant)}`;
}

export async function fetchState(tenant: TenantId): Promise<StateResponse> {
  return apiFetch<StateResponse>(withTenant("/state", tenant));
}

export async function runQuery(
  req: RunRequest,
  tenant: TenantId
): Promise<RunResponse> {
  return apiFetch<RunResponse>(withTenant("/run", tenant), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
}

export async function endorse(
  req: EndorseRequest,
  tenant: TenantId
): Promise<EndorseResponse> {
  return apiFetch<EndorseResponse>(withTenant("/endorse", tenant), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
}

export async function resetTenant(tenant: TenantId): Promise<ResetResponse> {
  return apiFetch<ResetResponse>(withTenant("/reset", tenant), {
    method: "POST",
  });
}
