import { Hono } from "hono";
import type { Env, PacticipantResponse, VersionResponse, TagResponse, DeploymentResponse } from "../types";
import { HalBuilder, getBaseUrl } from "../services/hal";
import { nameSchema, versionSchema, tagSchema, environmentNameSchema, validateParam } from "../lib/validation";

const app = new Hono<{ Bindings: Env }>();

// Helper to get DO stub
function getBroker(env: Env) {
  const id = env.PACT_BROKER.idFromName("pact-broker");
  return env.PACT_BROKER.get(id);
}

// List all pacticipants
app.get("/", async (c) => {
  const broker = getBroker(c.env);
  const pacticipants = await broker.getAllPacticipants();
  const hal = new HalBuilder(getBaseUrl(c.req.raw));

  const response = {
    _links: {
      self: hal.link("/pacticipants"),
    },
    _embedded: {
      pacticipants: pacticipants.map((p) => ({
        name: p.name,
        createdAt: p.createdAt,
        _links: hal.pacticipant(p.name),
      })),
    },
  };

  return c.json(response);
});

// Get a specific pacticipant
app.get("/:name", async (c) => {
  const nameResult = validateParam(c, nameSchema, c.req.param("name"), "name");
  if (!nameResult.valid) return nameResult.response;
  const name = nameResult.value;

  const broker = getBroker(c.env);
  const pacticipant = await broker.getPacticipant(name);

  if (!pacticipant) {
    return c.json(
      { error: "Not Found", message: "Pacticipant not found" },
      404
    );
  }

  const hal = new HalBuilder(getBaseUrl(c.req.raw));
  const response: PacticipantResponse = {
    name: pacticipant.name,
    createdAt: pacticipant.createdAt,
    _links: hal.pacticipant(pacticipant.name),
  };

  return c.json(response);
});

// List versions for a pacticipant
app.get("/:name/versions", async (c) => {
  const nameResult = validateParam(c, nameSchema, c.req.param("name"), "name");
  if (!nameResult.valid) return nameResult.response;
  const name = nameResult.value;

  const broker = getBroker(c.env);
  const versions = await broker.getVersionsByPacticipant(name);
  const hal = new HalBuilder(getBaseUrl(c.req.raw));

  const response = {
    _links: {
      self: hal.link(`/pacticipants/${encodeURIComponent(name)}/versions`),
    },
    _embedded: {
      versions: versions.map((v) => ({
        number: v.number,
        branch: v.branch,
        buildUrl: v.buildUrl,
        createdAt: v.createdAt,
        _links: hal.version(name, v.number),
      })),
    },
  };

  return c.json(response);
});

// Get a specific version
app.get("/:name/versions/:version", async (c) => {
  const nameResult = validateParam(c, nameSchema, c.req.param("name"), "name");
  if (!nameResult.valid) return nameResult.response;
  const name = nameResult.value;

  const versionResult = validateParam(c, versionSchema, c.req.param("version"), "version");
  if (!versionResult.valid) return versionResult.response;
  const versionNumber = versionResult.value;

  const broker = getBroker(c.env);
  const version = await broker.getVersion(name, versionNumber);

  if (!version) {
    return c.json(
      {
        error: "Not Found",
        message: "Version not found",
      },
      404
    );
  }

  const hal = new HalBuilder(getBaseUrl(c.req.raw));
  const response: VersionResponse = {
    number: version.number,
    branch: version.branch,
    buildUrl: version.buildUrl,
    createdAt: version.createdAt,
    _links: hal.version(name, version.number),
  };

  return c.json(response);
});

// Get tags for a version
app.get("/:name/versions/:version/tags", async (c) => {
  const name = c.req.param("name");
  const versionNumber = c.req.param("version");
  const broker = getBroker(c.env);
  const versionTags = await broker.getTagsForVersion(name, versionNumber);
  const hal = new HalBuilder(getBaseUrl(c.req.raw));

  const response = {
    _links: {
      self: hal.link(
        `/pacticipants/${encodeURIComponent(name)}/versions/${encodeURIComponent(versionNumber)}/tags`
      ),
    },
    _embedded: {
      tags: versionTags.map((t) => ({
        name: t.name,
        createdAt: t.createdAt,
        _links: hal.tag(name, versionNumber, t.name),
      })),
    },
  };

  return c.json(response);
});

// Get a specific tag
app.get("/:name/versions/:version/tags/:tag", async (c) => {
  const name = c.req.param("name");
  const versionNumber = c.req.param("version");
  const tagName = c.req.param("tag");
  const broker = getBroker(c.env);

  const tag = await broker.getTag(name, versionNumber, tagName);

  if (!tag) {
    return c.json(
      {
        error: "Not Found",
        message: `Tag '${tagName}' not found for version '${versionNumber}' of pacticipant '${name}'`,
      },
      404
    );
  }

  const hal = new HalBuilder(getBaseUrl(c.req.raw));
  const response: TagResponse = {
    name: tag.name,
    createdAt: tag.createdAt,
    _links: hal.tag(name, versionNumber, tag.name),
  };

  return c.json(response);
});

// Create/update a tag
app.put("/:name/versions/:version/tags/:tag", async (c) => {
  const name = c.req.param("name");
  const versionNumber = c.req.param("version");
  const tagName = c.req.param("tag");
  const broker = getBroker(c.env);

  // Ensure version exists first
  const version = await broker.getVersion(name, versionNumber);
  if (!version) {
    return c.json(
      {
        error: "Not Found",
        message: `Version '${versionNumber}' not found for pacticipant '${name}'`,
      },
      404
    );
  }

  const tag = await broker.addTag(name, versionNumber, tagName);

  if (!tag) {
    return c.json(
      { error: "Internal Error", message: "Failed to create tag" },
      500
    );
  }

  const hal = new HalBuilder(getBaseUrl(c.req.raw));
  const response: TagResponse = {
    name: tag.name,
    createdAt: tag.createdAt,
    _links: hal.tag(name, versionNumber, tag.name),
  };

  return c.json(response, 201);
});

// Get deployments for a version
app.get("/:name/versions/:version/deployed", async (c) => {
  const name = c.req.param("name");
  const versionNumber = c.req.param("version");
  const broker = getBroker(c.env);
  const deployments = await broker.getDeploymentsForVersion(name, versionNumber);
  const hal = new HalBuilder(getBaseUrl(c.req.raw));

  const response = {
    _links: {
      self: hal.link(
        `/pacticipants/${encodeURIComponent(name)}/versions/${encodeURIComponent(versionNumber)}/deployed`
      ),
    },
    _embedded: {
      deployments: deployments.map(({ deployment, environment }) => ({
        environment: environment.name,
        deployedAt: deployment.deployedAt,
        undeployedAt: deployment.undeployedAt,
        _links: hal.deployment(name, versionNumber, environment.name),
      })),
    },
  };

  return c.json(response);
});

// Record a deployment
app.put("/:name/versions/:version/deployed/:environment", async (c) => {
  const name = c.req.param("name");
  const versionNumber = c.req.param("version");
  const environmentName = c.req.param("environment");
  const broker = getBroker(c.env);

  // Ensure version exists first
  const version = await broker.getVersion(name, versionNumber);
  if (!version) {
    return c.json(
      {
        error: "Not Found",
        message: `Version '${versionNumber}' not found for pacticipant '${name}'`,
      },
      404
    );
  }

  const deployment = await broker.recordDeployment(name, versionNumber, environmentName);

  if (!deployment) {
    return c.json(
      { error: "Internal Error", message: "Failed to record deployment" },
      500
    );
  }

  const hal = new HalBuilder(getBaseUrl(c.req.raw));
  const response: DeploymentResponse = {
    environment: environmentName,
    deployedAt: deployment.deployedAt,
    undeployedAt: deployment.undeployedAt,
    _links: hal.deployment(name, versionNumber, environmentName),
  };

  return c.json(response, 201);
});

// Record an undeployment
app.delete("/:name/versions/:version/deployed/:environment", async (c) => {
  const name = c.req.param("name");
  const versionNumber = c.req.param("version");
  const environmentName = c.req.param("environment");
  const broker = getBroker(c.env);

  const success = await broker.recordUndeployment(name, versionNumber, environmentName);

  if (!success) {
    return c.json(
      {
        error: "Not Found",
        message: `No active deployment found for version '${versionNumber}' in environment '${environmentName}'`,
      },
      404
    );
  }

  return c.body(null, 204);
});

export { app as pacticipantRoutes };
