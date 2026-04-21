import { SELF } from "cloudflare:test";

export const TOKEN = "test-token-0123456789abcdef";
const BASE = "https://test-host";

export function authHeaders(
  token: string = TOKEN,
  extra: Record<string, string> = {},
): Record<string, string> {
  return { Authorization: `Bearer ${token}`, ...extra };
}

export async function req(path: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`, init);
}

export async function reqJson(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const res = await req(path, init);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON — leave as text
  }
  return { status: res.status, body };
}

export function samplePact(
  overrides: {
    consumer?: string;
    provider?: string;
    path?: string;
    description?: string;
  } = {},
): Record<string, unknown> {
  return {
    consumer: { name: overrides.consumer ?? "demo-c" },
    provider: { name: overrides.provider ?? "demo-p" },
    interactions: [
      {
        description: overrides.description ?? "a request",
        request: { method: "GET", path: overrides.path ?? "/ping" },
        response: { status: 200 },
      },
    ],
    metadata: { pactSpecification: { version: "2.0.0" } },
  };
}

export async function publishPact(
  consumer: string,
  provider: string,
  version: string,
  opts: {
    branch?: string;
    description?: string;
    path?: string;
  } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const qs = opts.branch ? `?branch=${encodeURIComponent(opts.branch)}` : "";
  const pact = samplePact({
    consumer,
    provider,
    description: opts.description,
    path: opts.path,
  });
  const res = await req(
    `/pacts/provider/${encodeURIComponent(provider)}/consumer/${encodeURIComponent(consumer)}/version/${encodeURIComponent(version)}${qs}`,
    {
      method: "PUT",
      headers: authHeaders(TOKEN, { "Content-Type": "application/json" }),
      body: JSON.stringify(pact),
    },
  );
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

export async function tagVersion(
  pacticipant: string,
  version: string,
  tag: string,
): Promise<number> {
  const res = await req(
    `/pacticipants/${encodeURIComponent(pacticipant)}/versions/${encodeURIComponent(version)}/tags/${encodeURIComponent(tag)}`,
    { method: "PUT", headers: authHeaders() },
  );
  return res.status;
}

export async function publishVerification(
  provider: string,
  consumer: string,
  sha: string,
  success: boolean,
  providerApplicationVersion: string = "p-1.0.0",
): Promise<number> {
  const res = await req(
    `/pacts/provider/${encodeURIComponent(provider)}/consumer/${encodeURIComponent(consumer)}/pact-version/${sha}/verification-results`,
    {
      method: "POST",
      headers: authHeaders(TOKEN, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        success,
        providerApplicationVersion,
        buildUrl: "https://ci.example/build/1",
      }),
    },
  );
  return res.status;
}

export async function recordDeployment(
  pacticipant: string,
  version: string,
  environment: string,
): Promise<number> {
  const res = await req(
    `/pacticipants/${encodeURIComponent(pacticipant)}/versions/${encodeURIComponent(version)}/deployed/${encodeURIComponent(environment)}`,
    { method: "PUT", headers: authHeaders() },
  );
  return res.status;
}

export async function ensureEnvironment(name: string): Promise<number> {
  const res = await req(`/environments/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: authHeaders(TOKEN, { "Content-Type": "application/json" }),
    body: JSON.stringify({ name, production: true, displayName: name }),
  });
  return res.status;
}
