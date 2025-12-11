import { Hono } from "hono";
import type { Env, PactResponse, PactContent } from "../types";
import { HalBuilder, getBaseUrl } from "../services/hal";

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
    const providerName = c.req.param("provider");
    const consumerName = c.req.param("consumer");
    const consumerVersion = c.req.param("version");

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
    const providerName = c.req.param("provider");
    const consumerName = c.req.param("consumer");
    const consumerVersion = c.req.param("version");

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
          message: `Pact not found for provider '${providerName}', consumer '${consumerName}', version '${consumerVersion}'`,
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

// Get latest pact (optionally by tag)
app.get("/provider/:provider/consumer/:consumer/latest/:tag?", async (c) => {
  const providerName = c.req.param("provider");
  const consumerName = c.req.param("consumer");
  const tag = c.req.param("tag");

  const broker = getBroker(c.env);
  const result = await broker.getLatestPact(
    providerName,
    consumerName,
    tag
  );

  if (!result) {
    const tagMsg = tag ? ` with tag '${tag}'` : "";
    return c.json(
      {
        error: "Not Found",
        message: `No pact found for provider '${providerName}' and consumer '${consumerName}'${tagMsg}`,
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
  const providerName = c.req.param("provider");

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

export { app as pactRoutes };
