import { Hono } from "hono";
import type { Env, MatrixResponse, CanIDeployResponse } from "../types";
import { HalBuilder, getBaseUrl } from "../services/hal";
import { summarizeMatrix, toSummaryRows } from "../services/matrix-summary";
import { decorateMatrixRow } from "../services/matrix-row";
import {
  nameSchema,
  versionSchema,
  branchSchema,
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
  // The reference client sends `environment=` for --to-environment and `tag=`
  // for --to (matrix/query.rb#query_options). Both narrow the provider side, so
  // both feed the same target resolution.
  const environmentRaw = c.req.query("q[][environment]") ?? c.req.query("environment");
  const targetRaw = environmentRaw ?? c.req.query("q[][tag]") ?? c.req.query("tag");
  // Remember which param it arrived on: if it resolves to nothing we still have
  // to describe it, and calling an empty environment a missing tag sends the
  // reader looking for the wrong thing.
  const targetKind = environmentRaw ? "environment" : "tag";

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

  const targetResult = validateOptionalQuery(c, branchSchema, targetRaw, "tag");
  if (!targetResult.valid) return targetResult.response;
  const target = targetResult.value;

  const broker = getBroker(c.env);
  const matrix = await broker.getMatrix(pacticipant, version, target, targetKind);
  const { summary, notices } = summarizeMatrix(toSummaryRows(matrix));

  const hal = new HalBuilder(getBaseUrl(c.req.raw));
  const response: MatrixResponse = {
    summary,
    notices,
    matrix: matrix.map((row) => decorateMatrixRow(hal, row)),
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

  // 'to' names an environment, a tag or a branch and we do not know which until
  // we try to resolve it, so validate against the most permissive of the three.
  // environmentNameSchema would reject `release/1.2` and `1.0.0-rc` outright.
  const toResult = validateOptionalQuery(c, branchSchema, toRaw, "to");
  if (!toResult.valid) return toResult.response;
  const toTag = toResult.value;

  const broker = getBroker(c.env);
  const result = await broker.canIDeploy(pacticipant, version, toTag);

  const hal = new HalBuilder(getBaseUrl(c.req.raw));
  const response: CanIDeployResponse = {
    summary: result.summary,
    notices: result.notices,
    matrix: result.matrix.map((row) => decorateMatrixRow(hal, row)),
    _links: hal.canIDeploy(),
  };

  return c.json(response);
});

export { app as matrixRoutes };
