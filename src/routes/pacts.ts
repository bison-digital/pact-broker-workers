import { Hono } from "hono";
import type { Env, PactResponse, PactContent, PactsForVerificationRequest, PactForVerification } from "../types";
import { HalBuilder, getBaseUrl } from "../services/hal";
import { nameSchema, versionSchema, shaSchema, branchSchema, tagSchema, validateParam } from "../lib/validation";

const app = new Hono<{ Bindings: Env }>();

// Helper to get DO stub
function getBroker(env: Env) {
  const id = env.PACT_BROKER.idFromName("pact-broker");
  return env.PACT_BROKER.get(id);
}

// Helper to build pact response
function buildPactResponse(
  hal: HalBuilder,
  pact: { content: string; contentSha: string; createdAt: string },
  consumer: { name: string },
  provider: { name: string },
  version: { number: string }
): PactResponse {
  const content = JSON.parse(pact.content) as PactContent;

  return {
    consumer: { name: consumer.name },
    provider: { name: provider.name },
    consumerVersion: version.number,
    contentSha: pact.contentSha,
    createdAt: pact.createdAt,
    interactions: content.interactions,
    metadata: content.metadata,
    _links: hal.pact(provider.name, consumer.name, version.number, pact.contentSha),
  };
}

// Publish a pact
app.put(
  "/provider/:provider/consumer/:consumer/version/:version",
  async (c) => {
    // Validate URL parameters
    const providerResult = validateParam(c, nameSchema, c.req.param("provider"), "provider");
    if (!providerResult.valid) return providerResult.response;
    const providerName = providerResult.value;

    const consumerResult = validateParam(c, nameSchema, c.req.param("consumer"), "consumer");
    if (!consumerResult.valid) return consumerResult.response;
    const consumerName = consumerResult.value;

    const versionResult = validateParam(c, versionSchema, c.req.param("version"), "version");
    if (!versionResult.valid) return versionResult.response;
    const consumerVersion = versionResult.value;

    // Validate optional branch query param
    const branchParam = c.req.query("branch");
    if (branchParam) {
      const branchResult = validateParam(c, branchSchema, branchParam, "branch");
      if (!branchResult.valid) return branchResult.response;
    }

    let body: PactContent;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: "Bad Request", message: "Invalid JSON body" },
        400
      );
    }

    // Validate basic pact structure
    if (!body.consumer || !body.provider || !body.interactions) {
      return c.json(
        {
          error: "Bad Request",
          message: "Pact must contain consumer, provider, and interactions",
        },
        400
      );
    }

    const broker = getBroker(c.env);

    // Get branch from query param if provided
    const branch = c.req.query("branch") ?? undefined;

    const { pact, created } = await broker.publishPact(
      consumerName,
      consumerVersion,
      providerName,
      body,
      branch
    );

    // Get full details for response
    const result = await broker.getPact(
      providerName,
      consumerName,
      consumerVersion
    );

    if (!result) {
      return c.json(
        { error: "Internal Error", message: "Failed to retrieve published pact" },
        500
      );
    }

    const hal = new HalBuilder(getBaseUrl(c.req.raw));
    const response = buildPactResponse(
      hal,
      result.pact,
      result.consumer,
      result.provider,
      result.version
    );

    return c.json(response, created ? 201 : 200);
  }
);

// Get a specific pact version
app.get(
  "/provider/:provider/consumer/:consumer/version/:version",
  async (c) => {
    // Validate URL parameters
    const providerResult = validateParam(c, nameSchema, c.req.param("provider"), "provider");
    if (!providerResult.valid) return providerResult.response;
    const providerName = providerResult.value;

    const consumerResult = validateParam(c, nameSchema, c.req.param("consumer"), "consumer");
    if (!consumerResult.valid) return consumerResult.response;
    const consumerName = consumerResult.value;

    const versionResult = validateParam(c, versionSchema, c.req.param("version"), "version");
    if (!versionResult.valid) return versionResult.response;
    const consumerVersion = versionResult.value;

    const broker = getBroker(c.env);
    const result = await broker.getPact(
      providerName,
      consumerName,
      consumerVersion
    );

    if (!result) {
      return c.json(
        {
          error: "Not Found",
          message: "Pact not found",
        },
        404
      );
    }

    const hal = new HalBuilder(getBaseUrl(c.req.raw));
    const response = buildPactResponse(
      hal,
      result.pact,
      result.consumer,
      result.provider,
      result.version
    );

    return c.json(response);
  }
);

// Get pact by content SHA (used by verifiers fetching from for-verification links)
app.get(
  "/provider/:provider/consumer/:consumer/pact-version/:sha",
  async (c) => {
    // Validate URL parameters
    const providerResult = validateParam(c, nameSchema, c.req.param("provider"), "provider");
    if (!providerResult.valid) return providerResult.response;
    const providerName = providerResult.value;

    const consumerResult = validateParam(c, nameSchema, c.req.param("consumer"), "consumer");
    if (!consumerResult.valid) return consumerResult.response;
    const consumerName = consumerResult.value;

    const shaResult = validateParam(c, shaSchema, c.req.param("sha"), "sha");
    if (!shaResult.valid) return shaResult.response;
    const sha = shaResult.value;

    const broker = getBroker(c.env);
    const result = await broker.getPactByContentShaFull(
      providerName,
      consumerName,
      sha
    );

    if (!result) {
      return c.json(
        {
          error: "Not Found",
          message: "Pact not found",
        },
        404
      );
    }

    const hal = new HalBuilder(getBaseUrl(c.req.raw));
    const response = buildPactResponse(
      hal,
      result.pact,
      result.consumer,
      result.provider,
      result.version
    );

    return c.json(response, 200, { "Content-Type": "application/hal+json" });
  }
);

// Get latest pact (optionally by tag)
app.get("/provider/:provider/consumer/:consumer/latest/:tag?", async (c) => {
  // Validate URL parameters
  const providerResult = validateParam(c, nameSchema, c.req.param("provider"), "provider");
  if (!providerResult.valid) return providerResult.response;
  const providerName = providerResult.value;

  const consumerResult = validateParam(c, nameSchema, c.req.param("consumer"), "consumer");
  if (!consumerResult.valid) return consumerResult.response;
  const consumerName = consumerResult.value;

  // Validate optional tag
  const tagParam = c.req.param("tag");
  let tag: string | undefined;
  if (tagParam) {
    const tagResult = validateParam(c, tagSchema, tagParam, "tag");
    if (!tagResult.valid) return tagResult.response;
    tag = tagResult.value;
  }

  const broker = getBroker(c.env);
  const result = await broker.getLatestPact(
    providerName,
    consumerName,
    tag
  );

  if (!result) {
    return c.json(
      {
        error: "Not Found",
        message: "Pact not found",
      },
      404
    );
  }

  const hal = new HalBuilder(getBaseUrl(c.req.raw));
  const response = buildPactResponse(
    hal,
    result.pact,
    result.consumer,
    result.provider,
    result.version
  );

  return c.json(response);
});

// Get all latest pacts for a provider
app.get("/provider/:provider/latest", async (c) => {
  // Validate URL parameters
  const providerResult = validateParam(c, nameSchema, c.req.param("provider"), "provider");
  if (!providerResult.valid) return providerResult.response;
  const providerName = providerResult.value;

  const broker = getBroker(c.env);
  const pacts = await broker.getLatestPactsForProvider(providerName);
  const hal = new HalBuilder(getBaseUrl(c.req.raw));

  const response = {
    _links: {
      self: hal.link(`/pacts/provider/${encodeURIComponent(providerName)}/latest`),
      provider: hal.link(`/pacticipants/${encodeURIComponent(providerName)}`),
    },
    _embedded: {
      pacts: pacts.map((p) =>
        buildPactResponse(hal, p.pact, p.consumer, p.provider, p.version)
      ),
    },
  };

  return c.json(response);
});

// Get all latest pacts
app.get("/latest", async (c) => {
  const broker = getBroker(c.env);
  const pacticipants = await broker.getAllPacticipants();
  const hal = new HalBuilder(getBaseUrl(c.req.raw));

  // Get latest pacts for all providers
  const allPacts: PactResponse[] = [];
  for (const p of pacticipants) {
    const pacts = await broker.getLatestPactsForProvider(p.name);
    for (const pact of pacts) {
      allPacts.push(
        buildPactResponse(hal, pact.pact, pact.consumer, pact.provider, pact.version)
      );
    }
  }

  const response = {
    _links: {
      self: hal.link("/pacts/latest"),
    },
    _embedded: {
      pacts: allPacts,
    },
  };

  return c.json(response);
});

// Pacts for verification - used by provider verifiers
// GET is deprecated but still used by some clients
app.get("/provider/:provider/for-verification", async (c) => {
  // Validate URL parameters
  const providerResult = validateParam(c, nameSchema, c.req.param("provider"), "provider");
  if (!providerResult.valid) return providerResult.response;
  const providerName = providerResult.value;

  const broker = getBroker(c.env);
  // GET uses default selectors (latest pacts)
  const selectors = [{ latest: true }];
  const results = await broker.getPactsForVerification(providerName, selectors);

  const hal = new HalBuilder(getBaseUrl(c.req.raw));
  const pacts: PactForVerification[] = results.map(({ pact, consumer, version, notices }) => ({
    shortDescription: `Pact between ${consumer.name} (${version.number}) and ${providerName}`,
    verificationProperties: {
      notices: notices.map((text) => ({
        text: `This pact is being verified because ${text}`,
        when: "before_verification",
      })),
      pending: false,
    },
    _links: {
      self: {
        href: `${hal.baseUrl}/pacts/provider/${encodeURIComponent(providerName)}/consumer/${encodeURIComponent(consumer.name)}/pact-version/${pact.contentSha}`,
        name: `Pact between ${consumer.name} (${version.number}) and ${providerName}`,
      },
    },
  }));

  return c.json(
    {
      _embedded: { pacts },
      _links: hal.pactsForVerification(providerName),
    },
    200,
    { "Content-Type": "application/hal+json" }
  );
});

// POST allows custom selectors
app.post("/provider/:provider/for-verification", async (c) => {
  // Validate URL parameters
  const providerResult = validateParam(c, nameSchema, c.req.param("provider"), "provider");
  if (!providerResult.valid) return providerResult.response;
  const providerName = providerResult.value;

  let body: PactsForVerificationRequest = {};
  try {
    body = await c.req.json();
  } catch {
    // Empty body is valid - defaults to latest pacts
  }

  const broker = getBroker(c.env);
  const selectors = body.consumerVersionSelectors || [{ latest: true }];
  const results = await broker.getPactsForVerification(providerName, selectors);

  const hal = new HalBuilder(getBaseUrl(c.req.raw));
  const pacts: PactForVerification[] = results.map(({ pact, consumer, version, notices }) => ({
    shortDescription: `Pact between ${consumer.name} (${version.number}) and ${providerName}`,
    verificationProperties: {
      notices: notices.map((text) => ({
        text: `This pact is being verified because ${text}`,
        when: "before_verification",
      })),
      pending: false,
    },
    _links: {
      self: {
        href: `${hal.baseUrl}/pacts/provider/${encodeURIComponent(providerName)}/consumer/${encodeURIComponent(consumer.name)}/pact-version/${pact.contentSha}`,
        name: `Pact between ${consumer.name} (${version.number}) and ${providerName}`,
      },
    },
  }));

  return c.json(
    {
      _embedded: { pacts },
      _links: hal.pactsForVerification(providerName),
    },
    200,
    { "Content-Type": "application/hal+json" }
  );
});

export { app as pactRoutes };
