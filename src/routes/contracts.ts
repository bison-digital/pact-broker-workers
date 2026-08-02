import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Env, PactContent } from "../types";
import { HalBuilder, getBaseUrl } from "../services/hal";
import {
  nameSchema,
  versionSchema,
  branchSchema,
  tagSchema,
  validateParam,
} from "../lib/validation";

const app = new Hono<{ Bindings: Env }>();

// Matches the per-pact cap on PUT /pacts/..., but a contracts/publish body can
// legitimately carry several pacts for one consumer, so the ceiling is higher.
const CONTRACTS_PUBLISH_MAX_BYTES = 4 * 1024 * 1024;
const MAX_INTERACTIONS = 1000;
const MAX_CONTRACTS = 100;

const contractsPublishBodyLimit = bodyLimit({
  maxSize: CONTRACTS_PUBLISH_MAX_BYTES,
  onError: (c) =>
    c.json(
      {
        error: "Payload Too Large",
        message: `Body exceeds maximum size of ${CONTRACTS_PUBLISH_MAX_BYTES} bytes`,
      },
      413,
    ),
});

function getBroker(env: Env) {
  const id = env.PACT_BROKER.idFromName("pact-broker");
  return env.PACT_BROKER.get(id);
}

interface ContractInput {
  consumerName?: unknown;
  providerName?: unknown;
  specification?: unknown;
  contentType?: unknown;
  content?: unknown;
}

interface PublishContractsRequest {
  pacticipantName?: unknown;
  pacticipantVersionNumber?: unknown;
  branch?: unknown;
  buildUrl?: unknown;
  tags?: unknown;
  contracts?: unknown;
}

/** Decode a base64 contract body into a pact, or null if it isn't one. */
function decodeContract(content: unknown): PactContent | null {
  if (typeof content !== "string") return null;

  let json: string;
  try {
    json = atob(content);
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(json) as PactContent;
    if (!parsed.consumer || !parsed.provider || !Array.isArray(parsed.interactions)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Publish one consumer version's contracts.
 *
 * `pact-broker publish` only takes this path when the index advertises
 * `pb:publish-contracts` (publish_pacts.rb#call). The legacy fallback cannot
 * record branches at all — it warns and publishes anyway — so without this
 * endpoint `--branch` silently does nothing.
 */
app.post("/publish", contractsPublishBodyLimit, async (c) => {
  let body: PublishContractsRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Bad Request", message: "Invalid JSON body" }, 400);
  }

  const nameResult = validateParam(
    c,
    nameSchema,
    typeof body.pacticipantName === "string" ? body.pacticipantName : undefined,
    "pacticipantName",
  );
  if (!nameResult.valid) return nameResult.response;
  const pacticipantName = nameResult.value;

  const versionResult = validateParam(
    c,
    versionSchema,
    typeof body.pacticipantVersionNumber === "string" ? body.pacticipantVersionNumber : undefined,
    "pacticipantVersionNumber",
  );
  if (!versionResult.valid) return versionResult.response;
  const versionNumber = versionResult.value;

  let branch: string | undefined;
  if (typeof body.branch === "string" && body.branch !== "") {
    const branchResult = validateParam(c, branchSchema, body.branch, "branch");
    if (!branchResult.valid) return branchResult.response;
    branch = branchResult.value;
  }

  const buildUrl =
    typeof body.buildUrl === "string" && body.buildUrl !== "" ? body.buildUrl : undefined;

  const tags: string[] = [];
  if (Array.isArray(body.tags)) {
    for (const tag of body.tags) {
      const tagResult = validateParam(
        c,
        tagSchema,
        typeof tag === "string" ? tag : undefined,
        "tag",
      );
      if (!tagResult.valid) return tagResult.response;
      tags.push(tagResult.value);
    }
  }

  if (!Array.isArray(body.contracts) || body.contracts.length === 0) {
    return c.json({ error: "Bad Request", message: "At least one contract is required" }, 400);
  }

  if (body.contracts.length > MAX_CONTRACTS) {
    return c.json(
      {
        error: "Bad Request",
        message: `Request contains ${body.contracts.length} contracts; the maximum is ${MAX_CONTRACTS}`,
      },
      400,
    );
  }

  // Decode and validate everything before writing anything, so a malformed
  // contract can't leave a half-published version behind.
  const decoded: Array<{ providerName: string; content: PactContent }> = [];
  for (const raw of body.contracts as ContractInput[]) {
    const providerResult = validateParam(
      c,
      nameSchema,
      typeof raw.providerName === "string" ? raw.providerName : undefined,
      "providerName",
    );
    if (!providerResult.valid) return providerResult.response;

    const content = decodeContract(raw.content);
    if (!content) {
      return c.json(
        {
          error: "Bad Request",
          message: "contract content must be base64-encoded pact JSON",
        },
        400,
      );
    }

    if (content.interactions.length > MAX_INTERACTIONS) {
      return c.json(
        {
          error: "Bad Request",
          message: `Pact contains ${content.interactions.length} interactions; the maximum is ${MAX_INTERACTIONS}`,
        },
        400,
      );
    }

    decoded.push({ providerName: providerResult.value, content });
  }

  const broker = getBroker(c.env);
  const notices: Array<{ type: string; text: string }> = [];

  for (const { providerName, content } of decoded) {
    const { pact } = await broker.publishPact(
      pacticipantName,
      versionNumber,
      providerName,
      content,
      branch,
    );

    c.executionCtx.waitUntil(broker.dispatchContractPublished(pact.id, `pact:${pact.id}`));

    notices.push({
      type: "success",
      text: `Successfully published pact for ${pacticipantName} version ${versionNumber} and provider ${providerName}`,
    });
  }

  // publishPact only backfills the branch, and never sees the build URL. Both
  // are explicit here, so state them on the version directly.
  if (branch) {
    await broker.recordVersionBranch(pacticipantName, versionNumber, branch);
    notices.push({
      type: "debug",
      text: `Version ${versionNumber} of ${pacticipantName} is on branch ${branch}`,
    });
  }
  if (buildUrl) {
    await broker.recordVersionBuildUrl(pacticipantName, versionNumber, buildUrl);
  }

  for (const tag of tags) {
    await broker.addTag(pacticipantName, versionNumber, tag);
    notices.push({
      type: "debug",
      text: `Tagged version ${versionNumber} of ${pacticipantName} as "${tag}"`,
    });
  }

  const hal = new HalBuilder(getBaseUrl(c.req.raw));
  return c.json(
    {
      notices,
      _links: {
        "pb:pacticipant-version": hal.link(
          `/pacticipants/${encodeURIComponent(pacticipantName)}/versions/${encodeURIComponent(versionNumber)}`,
        ),
      },
    },
    200,
    { "Content-Type": "application/hal+json" },
  );
});

export { app as contractRoutes };
