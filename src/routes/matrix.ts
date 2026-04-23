import { Hono } from "hono";
import type { Env, MatrixResponse, CanIDeployResponse } from "../types";
import { HalBuilder, getBaseUrl } from "../services/hal";
import {
  nameSchema,
  versionSchema,
  tagSchema,
  environmentNameSchema,
  validateParam,
  validateOptionalQuery,
} from "../lib/validation";

const app = new Hono<{ Bindings: Env }>();

// Helper to get DO stub
function getBroker(env: Env) {
  const id = env.PACT_BROKER.idFromName("pact-broker");
  return env.PACT_BROKER.get(id);
}

// Query the matrix
app.get("/matrix", async (c) => {
  // Parse query params - supports both array format and single values
  const pacticipantRaw = c.req.query("q[][pacticipant]") ?? c.req.query("pacticipant");
  const versionRaw = c.req.query("q[][version]") ?? c.req.query("version");
  const latestTagRaw = c.req.query("q[][tag]") ?? c.req.query("tag");

  if (!pacticipantRaw) {
    return c.json(
      {
        error: "Bad Request",
        message: "pacticipant query parameter is required",
      },
      400,
    );
  }

  const pacticipantResult = validateParam(c, nameSchema, pacticipantRaw, "pacticipant");
  if (!pacticipantResult.valid) return pacticipantResult.response;
  const pacticipant = pacticipantResult.value;

  const versionResult = validateOptionalQuery(c, versionSchema, versionRaw, "version");
  if (!versionResult.valid) return versionResult.response;
  const version = versionResult.value;

  const tagResult = validateOptionalQuery(c, tagSchema, latestTagRaw, "tag");
  if (!tagResult.valid) return tagResult.response;
  const latestTag = tagResult.value;

  const broker = getBroker(c.env);
  const matrix = await broker.getMatrix(pacticipant, version, latestTag);

  const hal = new HalBuilder(getBaseUrl(c.req.raw));
  const response: MatrixResponse = {
    summary: {
      deployable: matrix.every((row) => row.verificationResult?.success === true),
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
  const pacticipantRaw = c.req.query("pacticipant");
  const versionRaw = c.req.query("version");
  const toRaw = c.req.query("to") ?? c.req.query("toTag");

  if (!pacticipantRaw || !versionRaw) {
    return c.json(
      {
        error: "Bad Request",
        message: "pacticipant and version query parameters are required",
      },
      400,
    );
  }

  const pacticipantResult = validateParam(c, nameSchema, pacticipantRaw, "pacticipant");
  if (!pacticipantResult.valid) return pacticipantResult.response;
  const pacticipant = pacticipantResult.value;

  const versionResult = validateParam(c, versionSchema, versionRaw, "version");
  if (!versionResult.valid) return versionResult.response;
  const version = versionResult.value;

  // 'to' can be either an environment name or a tag — both use the same permitted
  // character set, so validate with environmentNameSchema if present (strictest).
  const toResult = validateOptionalQuery(c, environmentNameSchema, toRaw, "to");
  if (!toResult.valid) return toResult.response;
  const toTag = toResult.value;

  const broker = getBroker(c.env);
  const result = await broker.canIDeploy(pacticipant, version, toTag);

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
