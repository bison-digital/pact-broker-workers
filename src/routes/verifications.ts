import { Hono } from "hono";
import type { Env, VerificationResultRequest, VerificationResultResponse } from "../types";
import { HalBuilder, getBaseUrl } from "../services/hal";
import { nameSchema, shaSchema, idSchema, validateParam, parseId } from "../lib/validation";

const app = new Hono<{ Bindings: Env }>();

// Helper to get DO stub
function getBroker(env: Env) {
  const id = env.PACT_BROKER.idFromName("pact-broker");
  return env.PACT_BROKER.get(id);
}

// Get a specific verification result
app.get(
  "/provider/:provider/consumer/:consumer/pact-version/:sha/verification-results/:id",
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
    const pactSha = shaResult.value;

    const idResult = validateParam(c, idSchema, c.req.param("id"), "id");
    if (!idResult.valid) return idResult.response;
    const id = parseId(idResult.value);

    const broker = getBroker(c.env);
    const result = await broker.getVerificationById(id);

    if (!result) {
      return c.json(
        { error: "Not Found", message: "Verification not found" },
        404
      );
    }

    // Verify the pact SHA matches
    if (result.pact.contentSha !== pactSha) {
      return c.json(
        { error: "Not Found", message: "Verification not found" },
        404
      );
    }

    const hal = new HalBuilder(getBaseUrl(c.req.raw));
    const response: VerificationResultResponse = {
      success: result.verification.success,
      providerApplicationVersion: result.providerVersion.number,
      buildUrl: result.verification.buildUrl,
      verifiedAt: result.verification.verifiedAt,
      _links: hal.verification(providerName, consumerName, pactSha, result.verification.id),
    };

    return c.json(response);
  }
);

// Publish verification results
app.post(
  "/provider/:provider/consumer/:consumer/pact-version/:sha/verification-results",
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
    const pactSha = shaResult.value;

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
          message: "Pact not found",
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
