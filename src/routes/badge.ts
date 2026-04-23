import { Hono } from "hono";
import type { Env } from "../types";
import { nameSchema, tagSchema, validateOptionalQuery, validateParam } from "../lib/validation";

const app = new Hono<{ Bindings: Env }>();

function getBroker(env: Env) {
  const id = env.PACT_BROKER.idFromName("pact-broker");
  return env.PACT_BROKER.get(id);
}

type Status = "verified" | "failed" | "unknown";

const COLOURS: Record<Status, string> = {
  verified: "#4c1",
  failed: "#e05d44",
  unknown: "#9f9f9f",
};

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Very small SVG template. Width heuristic: 6 px per char + fixed padding.
function renderBadgeSvg(label: string, status: Status): string {
  const statusText =
    status === "verified" ? "verified" : status === "failed" ? "failed" : "unknown";
  const labelW = Math.max(40, label.length * 7 + 10);
  const valueW = Math.max(60, statusText.length * 7 + 10);
  const total = labelW + valueW;
  const colour = COLOURS[status];
  const esc = escapeXml;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${esc(label)}: ${statusText}">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelW}" height="20" fill="#555"/>
    <rect x="${labelW}" width="${valueW}" height="20" fill="${colour}"/>
    <rect width="${total}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelW / 2}" y="14">${esc(label)}</text>
    <text x="${labelW + valueW / 2}" y="14">${statusText}</text>
  </g>
</svg>`;
}

app.get("/provider/:provider/consumer/:consumer/badge", async (c) => {
  const providerResult = validateParam(c, nameSchema, c.req.param("provider"), "provider");
  if (!providerResult.valid) return providerResult.response;
  const consumerResult = validateParam(c, nameSchema, c.req.param("consumer"), "consumer");
  if (!consumerResult.valid) return consumerResult.response;

  const tagResult = validateOptionalQuery(c, tagSchema, c.req.query("tag"), "tag");
  if (!tagResult.valid) return tagResult.response;
  const tag = tagResult.value;

  const label = (c.req.query("label") ?? "pact").slice(0, 40);

  const broker = getBroker(c.env);
  let status: Status = "unknown";
  try {
    const latest = await broker.getLatestPact(providerResult.value, consumerResult.value, tag);
    if (latest) {
      const verifications = await broker.getVerificationsForPact(latest.pact.id);
      if (verifications.length > 0) {
        status = verifications[0]!.success ? "verified" : "failed";
      }
    }
  } catch {
    status = "unknown";
  }

  return new Response(renderBadgeSvg(label, status), {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=60",
    },
  });
});

export { app as badgeRoutes };
