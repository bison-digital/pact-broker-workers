import { Hono } from "hono";
import type { Env, MatrixResponse, CanIDeployResponse } from "../types";
import { HalBuilder, getBaseUrl } from "../services/hal";

const app = new Hono<{ Bindings: Env }>();

// Helper to get DO stub
function getBroker(env: Env) {
  const id = env.PACT_BROKER.idFromName("pact-broker");
  return env.PACT_BROKER.get(id);
}

// Query the matrix
app.get("/matrix", async (c) => {
  // Parse query params - supports both array format and single values
  const pacticipant =
    c.req.query("q[][pacticipant]") ?? c.req.query("pacticipant");
  const version = c.req.query("q[][version]") ?? c.req.query("version");
  const latestTag = c.req.query("q[][tag]") ?? c.req.query("tag");

  if (!pacticipant) {
    return c.json(
      {
        error: "Bad Request",
        message: "pacticipant query parameter is required",
      },
      400
    );
  }

  const broker = getBroker(c.env);
  const matrix = await broker.getMatrix(
    pacticipant,
    version ?? undefined,
    latestTag ?? undefined
  );

  const hal = new HalBuilder(getBaseUrl(c.req.raw));
  const response: MatrixResponse = {
    summary: {
      deployable: matrix.every(
        (row) => row.verificationResult?.success === true
      ),
      reason:
        matrix.length === 0
          ? "No pacts found"
          : matrix.every((row) => row.verificationResult?.success === true)
            ? "All pacts verified successfully"
            : "Some pacts failed verification or are unverified",
    },
    matrix,
    _links: hal.matrix(),
  };

  return c.json(response);
});

// Can I Deploy endpoint
app.get("/can-i-deploy", async (c) => {
  const pacticipant = c.req.query("pacticipant");
  const version = c.req.query("version");
  const toTag = c.req.query("to") ?? c.req.query("toTag");

  if (!pacticipant || !version) {
    return c.json(
      {
        error: "Bad Request",
        message: "pacticipant and version query parameters are required",
      },
      400
    );
  }

  const broker = getBroker(c.env);
  const result = await broker.canIDeploy(
    pacticipant,
    version,
    toTag ?? undefined
  );

  const hal = new HalBuilder(getBaseUrl(c.req.raw));
  const response: CanIDeployResponse = {
    summary: {
      deployable: result.deployable,
      reason: result.reason,
    },
    matrix: result.matrix,
    _links: hal.canIDeploy(),
  };

  // Return appropriate status code based on deployability
  return c.json(response, result.deployable ? 200 : 200);
});

export { app as matrixRoutes };
