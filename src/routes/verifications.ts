import { Hono } from "hono";
import type { Env, VerificationResultRequest, VerificationResultResponse } from "../types";
import { HalBuilder, getBaseUrl } from "../services/hal";

const app = new Hono<{ Bindings: Env }>();

// Helper to get DO stub
function getBroker(env: Env) {
  const id = env.PACT_BROKER.idFromName("pact-broker");
  return env.PACT_BROKER.get(id);
}

// Publish verification results
app.post(
  "/provider/:provider/consumer/:consumer/pact-version/:sha/verification-results",
  async (c) => {
    const providerName = c.req.param("provider");
    const consumerName = c.req.param("consumer");
    const pactSha = c.req.param("sha");

    let body: VerificationResultRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: "Bad Request", message: "Invalid JSON body" },
        400
      );
    }

    if (typeof body.success !== "boolean") {
      return c.json(
        { error: "Bad Request", message: "success field is required and must be boolean" },
        400
      );
    }

    if (!body.providerApplicationVersion) {
      return c.json(
        { error: "Bad Request", message: "providerApplicationVersion is required" },
        400
      );
    }

    const broker = getBroker(c.env);

    const verification = await broker.publishVerification(
      providerName,
      consumerName,
      pactSha,
      body.providerApplicationVersion,
      body.success,
      body.buildUrl
    );

    if (!verification) {
      return c.json(
        {
          error: "Not Found",
          message: `Pact with SHA '${pactSha}' not found`,
        },
        404
      );
    }

    const hal = new HalBuilder(getBaseUrl(c.req.raw));
    const response: VerificationResultResponse = {
      success: verification.success,
      providerApplicationVersion: body.providerApplicationVersion,
      buildUrl: verification.buildUrl,
      verifiedAt: verification.verifiedAt,
      _links: hal.verification(providerName, consumerName, pactSha, verification.id),
    };

    return c.json(response, 201);
  }
);

export { app as verificationRoutes };
