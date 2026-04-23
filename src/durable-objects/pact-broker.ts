import { DurableObject } from "cloudflare:workers";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { eq, and, desc, isNull } from "drizzle-orm";
import {
  pacticipants,
  versions,
  tags,
  pacts,
  verifications,
  environments,
  deployedVersions,
  webhooks,
  webhookExecutions,
  type Pacticipant,
  type Version,
  type Tag,
  type Pact,
  type Verification,
  type Environment,
  type DeployedVersion,
  type Webhook,
  type WebhookExecution,
} from "../db/schema";
import { runMigrations } from "../db/migrations";
import type {
  Env,
  PactContent,
  MatrixRow,
  ConsumerVersionSelector,
  WebhookEvent,
  WebhookEventPayload,
} from "../types";

const MAX_WEBHOOK_RESPONSE_BYTES = 4 * 1024;
const WEBHOOK_RETRY_DELAYS_MS = [200, 800, 3200];

export class PactBrokerDO extends DurableObject<Env> {
  private db: DrizzleSqliteDODatabase;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // Initialize Drizzle with DO storage
    this.db = drizzle(ctx.storage, { logger: false });

    // Run migrations on construction
    this.ctx.blockConcurrencyWhile(async () => {
      runMigrations(ctx.storage.sql);
    });
  }

  // ============ Pacticipant Operations ============

  async getOrCreatePacticipant(name: string): Promise<Pacticipant> {
    const existing = this.db.select().from(pacticipants).where(eq(pacticipants.name, name)).get();

    if (existing) return existing;

    const result = this.db.insert(pacticipants).values({ name }).returning().get();

    return result;
  }

  async getPacticipant(name: string): Promise<Pacticipant | undefined> {
    return this.db.select().from(pacticipants).where(eq(pacticipants.name, name)).get();
  }

  async getAllPacticipants(): Promise<Pacticipant[]> {
    return this.db.select().from(pacticipants).all();
  }

  // ============ Version Operations ============

  async getOrCreateVersion(
    pacticipantName: string,
    versionNumber: string,
    branch?: string,
    buildUrl?: string,
  ): Promise<{ pacticipant: Pacticipant; version: Version }> {
    const pacticipant = await this.getOrCreatePacticipant(pacticipantName);

    const existing = this.db
      .select()
      .from(versions)
      .where(and(eq(versions.pacticipantId, pacticipant.id), eq(versions.number, versionNumber)))
      .get();

    if (existing) {
      return { pacticipant, version: existing };
    }

    const version = this.db
      .insert(versions)
      .values({
        pacticipantId: pacticipant.id,
        number: versionNumber,
        branch,
        buildUrl,
      })
      .returning()
      .get();

    return { pacticipant, version };
  }

  async getVersion(pacticipantName: string, versionNumber: string): Promise<Version | undefined> {
    const pacticipant = await this.getPacticipant(pacticipantName);
    if (!pacticipant) return undefined;

    return this.db
      .select()
      .from(versions)
      .where(and(eq(versions.pacticipantId, pacticipant.id), eq(versions.number, versionNumber)))
      .get();
  }

  async getVersionsByPacticipant(pacticipantName: string): Promise<Version[]> {
    const pacticipant = await this.getPacticipant(pacticipantName);
    if (!pacticipant) return [];

    return this.db
      .select()
      .from(versions)
      .where(eq(versions.pacticipantId, pacticipant.id))
      .orderBy(desc(versions.createdAt))
      .all();
  }

  // ============ Tag Operations ============

  async addTag(
    pacticipantName: string,
    versionNumber: string,
    tagName: string,
  ): Promise<Tag | null> {
    const version = await this.getVersion(pacticipantName, versionNumber);
    if (!version) return null;

    // Check if tag already exists
    const existing = this.db
      .select()
      .from(tags)
      .where(and(eq(tags.versionId, version.id), eq(tags.name, tagName)))
      .get();

    if (existing) return existing;

    return this.db.insert(tags).values({ versionId: version.id, name: tagName }).returning().get();
  }

  async getTagsForVersion(pacticipantName: string, versionNumber: string): Promise<Tag[]> {
    const version = await this.getVersion(pacticipantName, versionNumber);
    if (!version) return [];

    return this.db.select().from(tags).where(eq(tags.versionId, version.id)).all();
  }

  async getLatestVersionByTag(
    pacticipantName: string,
    tagName: string,
  ): Promise<Version | undefined> {
    const pacticipant = await this.getPacticipant(pacticipantName);
    if (!pacticipant) return undefined;

    const result = this.db
      .select({ version: versions })
      .from(versions)
      .innerJoin(tags, eq(tags.versionId, versions.id))
      .where(and(eq(versions.pacticipantId, pacticipant.id), eq(tags.name, tagName)))
      .orderBy(desc(versions.createdAt))
      .get();

    return result?.version;
  }

  // ============ Pact Operations ============

  async publishPact(
    consumerName: string,
    consumerVersion: string,
    providerName: string,
    content: PactContent,
    branch?: string,
  ): Promise<{ pact: Pact; created: boolean }> {
    // Ensure consumer and provider exist
    const { version: consumerVer } = await this.getOrCreateVersion(
      consumerName,
      consumerVersion,
      branch,
    );
    const provider = await this.getOrCreatePacticipant(providerName);

    // Calculate content SHA
    const contentStr = JSON.stringify(content);
    const contentSha = await this.sha256(contentStr);

    // Check for existing pact
    const existing = this.db
      .select()
      .from(pacts)
      .where(and(eq(pacts.consumerVersionId, consumerVer.id), eq(pacts.providerId, provider.id)))
      .get();

    if (existing) {
      // Update if content changed
      if (existing.contentSha !== contentSha) {
        this.db
          .update(pacts)
          .set({ content: contentStr, contentSha })
          .where(eq(pacts.id, existing.id))
          .run();

        return {
          pact: { ...existing, content: contentStr, contentSha },
          created: false,
        };
      }
      return { pact: existing, created: false };
    }

    // Create new pact
    const pact = this.db
      .insert(pacts)
      .values({
        consumerVersionId: consumerVer.id,
        providerId: provider.id,
        content: contentStr,
        contentSha,
      })
      .returning()
      .get();

    return { pact, created: true };
  }

  async getPact(
    providerName: string,
    consumerName: string,
    consumerVersion: string,
  ): Promise<{
    pact: Pact;
    consumer: Pacticipant;
    provider: Pacticipant;
    version: Version;
  } | null> {
    const consumer = await this.getPacticipant(consumerName);
    const provider = await this.getPacticipant(providerName);
    if (!consumer || !provider) return null;

    const version = await this.getVersion(consumerName, consumerVersion);
    if (!version) return null;

    const pact = this.db
      .select()
      .from(pacts)
      .where(and(eq(pacts.consumerVersionId, version.id), eq(pacts.providerId, provider.id)))
      .get();

    if (!pact) return null;

    return { pact, consumer, provider, version };
  }

  async getLatestPact(
    providerName: string,
    consumerName: string,
    tag?: string,
  ): Promise<{
    pact: Pact;
    consumer: Pacticipant;
    provider: Pacticipant;
    version: Version;
  } | null> {
    const consumer = await this.getPacticipant(consumerName);
    const provider = await this.getPacticipant(providerName);
    if (!consumer || !provider) return null;

    let version: Version | undefined;

    if (tag) {
      version = await this.getLatestVersionByTag(consumerName, tag);
    } else {
      // Get latest version with a pact for this provider
      const result = this.db
        .select({ version: versions })
        .from(versions)
        .innerJoin(pacts, eq(pacts.consumerVersionId, versions.id))
        .where(and(eq(versions.pacticipantId, consumer.id), eq(pacts.providerId, provider.id)))
        .orderBy(desc(versions.createdAt))
        .get();

      version = result?.version;
    }

    if (!version) return null;

    const pact = this.db
      .select()
      .from(pacts)
      .where(and(eq(pacts.consumerVersionId, version.id), eq(pacts.providerId, provider.id)))
      .get();

    if (!pact) return null;

    return { pact, consumer, provider, version };
  }

  async getLatestPactsForProvider(providerName: string): Promise<
    Array<{
      pact: Pact;
      consumer: Pacticipant;
      provider: Pacticipant;
      version: Version;
    }>
  > {
    const provider = await this.getPacticipant(providerName);
    if (!provider) return [];

    // Get all consumers that have pacts with this provider
    const consumerIds = this.db
      .selectDistinct({ consumerId: versions.pacticipantId })
      .from(pacts)
      .innerJoin(versions, eq(pacts.consumerVersionId, versions.id))
      .where(eq(pacts.providerId, provider.id))
      .all();

    const results: Array<{
      pact: Pact;
      consumer: Pacticipant;
      provider: Pacticipant;
      version: Version;
    }> = [];

    for (const { consumerId } of consumerIds) {
      const consumer = this.db
        .select()
        .from(pacticipants)
        .where(eq(pacticipants.id, consumerId))
        .get();

      if (consumer) {
        const latest = await this.getLatestPact(providerName, consumer.name);
        if (latest) results.push(latest);
      }
    }

    return results;
  }

  async getPactByContentSha(sha: string): Promise<Pact | undefined> {
    return this.db.select().from(pacts).where(eq(pacts.contentSha, sha)).get();
  }

  async getPactByContentShaFull(
    providerName: string,
    consumerName: string,
    sha: string,
  ): Promise<{
    pact: Pact;
    consumer: Pacticipant;
    provider: Pacticipant;
    version: Version;
  } | null> {
    const consumer = await this.getPacticipant(consumerName);
    const provider = await this.getPacticipant(providerName);
    if (!consumer || !provider) return null;

    const pact = this.db
      .select()
      .from(pacts)
      .where(and(eq(pacts.contentSha, sha), eq(pacts.providerId, provider.id)))
      .get();

    if (!pact) return null;

    // Get the version from the pact's consumerVersionId
    const version = this.db
      .select()
      .from(versions)
      .where(and(eq(versions.id, pact.consumerVersionId), eq(versions.pacticipantId, consumer.id)))
      .get();

    if (!version) return null;

    return { pact, consumer, provider, version };
  }

  // ============ Verification Operations ============

  async publishVerification(
    providerName: string,
    _consumerName: string,
    pactSha: string,
    providerVersion: string,
    success: boolean,
    buildUrl?: string,
  ): Promise<Verification | null> {
    // Find pact by SHA
    const pact = await this.getPactByContentSha(pactSha);
    if (!pact) return null;

    // Get or create provider version
    const { version: providerVer } = await this.getOrCreateVersion(providerName, providerVersion);

    // Create verification result
    return this.db
      .insert(verifications)
      .values({
        pactId: pact.id,
        providerVersionId: providerVer.id,
        success,
        buildUrl,
      })
      .returning()
      .get();
  }

  async getVerificationsForPact(pactId: number): Promise<Verification[]> {
    return this.db
      .select()
      .from(verifications)
      .where(eq(verifications.pactId, pactId))
      .orderBy(desc(verifications.verifiedAt))
      .all();
  }

  async getVerificationById(id: number): Promise<{
    verification: Verification;
    providerVersion: Version;
    pact: Pact;
  } | null> {
    const verification = this.db.select().from(verifications).where(eq(verifications.id, id)).get();

    if (!verification) return null;

    const providerVersion = this.db
      .select()
      .from(versions)
      .where(eq(versions.id, verification.providerVersionId))
      .get();

    const pact = this.db.select().from(pacts).where(eq(pacts.id, verification.pactId)).get();

    if (!providerVersion || !pact) return null;

    return { verification, providerVersion, pact };
  }

  async getTag(
    pacticipantName: string,
    versionNumber: string,
    tagName: string,
  ): Promise<Tag | null> {
    const version = await this.getVersion(pacticipantName, versionNumber);
    if (!version) return null;

    return (
      this.db
        .select()
        .from(tags)
        .where(and(eq(tags.versionId, version.id), eq(tags.name, tagName)))
        .get() ?? null
    );
  }

  // ============ Matrix / Can-I-Deploy Operations ============

  async getMatrix(pacticipantName: string, version?: string, toTag?: string): Promise<MatrixRow[]> {
    const pacticipant = await this.getPacticipant(pacticipantName);
    if (!pacticipant) return [];

    // Get all pacts where this pacticipant is the consumer
    const consumerPacts = this.db
      .select({
        pact: pacts,
        consumerVersion: versions,
      })
      .from(pacts)
      .innerJoin(versions, eq(pacts.consumerVersionId, versions.id))
      .where(eq(versions.pacticipantId, pacticipant.id))
      .all();

    const rows: MatrixRow[] = [];

    // Process consumer pacts
    for (const { pact, consumerVersion } of consumerPacts) {
      if (version && consumerVersion.number !== version) continue;

      const consumer = this.db
        .select()
        .from(pacticipants)
        .where(eq(pacticipants.id, consumerVersion.pacticipantId))
        .get();
      const provider = this.db
        .select()
        .from(pacticipants)
        .where(eq(pacticipants.id, pact.providerId))
        .get();

      if (!consumer || !provider) continue;

      // Get latest verification for target tag if specified
      let verification: Verification | undefined;
      if (toTag) {
        const providerVersion = await this.getLatestVersionByTag(provider.name, toTag);
        if (providerVersion) {
          verification = this.db
            .select()
            .from(verifications)
            .where(
              and(
                eq(verifications.pactId, pact.id),
                eq(verifications.providerVersionId, providerVersion.id),
              ),
            )
            .orderBy(desc(verifications.verifiedAt))
            .get();
        }
      } else {
        verification = this.db
          .select()
          .from(verifications)
          .where(eq(verifications.pactId, pact.id))
          .orderBy(desc(verifications.verifiedAt))
          .get();
      }

      rows.push({
        consumer: { name: consumer.name, version: consumerVersion.number },
        provider: { name: provider.name, version: null },
        pactVersion: { sha: pact.contentSha },
        verificationResult: verification
          ? {
              success: verification.success,
              verifiedAt: verification.verifiedAt,
            }
          : null,
      });
    }

    return rows;
  }

  async canIDeploy(
    pacticipantName: string,
    version: string,
    toTag?: string,
  ): Promise<{ deployable: boolean; reason: string; matrix: MatrixRow[] }> {
    const matrix = await this.getMatrix(pacticipantName, version, toTag);

    if (matrix.length === 0) {
      return {
        deployable: true,
        reason: "No pacts found for this version",
        matrix: [],
      };
    }

    const unverified = matrix.filter((row) => !row.verificationResult);
    const failed = matrix.filter(
      (row) => row.verificationResult && !row.verificationResult.success,
    );

    if (unverified.length > 0) {
      return {
        deployable: false,
        reason: `${unverified.length} pact(s) have not been verified`,
        matrix,
      };
    }

    if (failed.length > 0) {
      return {
        deployable: false,
        reason: `${failed.length} pact verification(s) failed`,
        matrix,
      };
    }

    return {
      deployable: true,
      reason: "All pacts verified successfully",
      matrix,
    };
  }

  // ============ Environment Operations ============

  async getOrCreateEnvironment(
    name: string,
    displayName?: string,
    production?: boolean,
  ): Promise<Environment> {
    const existing = this.db.select().from(environments).where(eq(environments.name, name)).get();

    if (existing) {
      // Update if values provided
      if (displayName !== undefined || production !== undefined) {
        this.db
          .update(environments)
          .set({
            ...(displayName !== undefined && { displayName }),
            ...(production !== undefined && { production }),
          })
          .where(eq(environments.id, existing.id))
          .run();
        return {
          ...existing,
          displayName: displayName ?? existing.displayName,
          production: production ?? existing.production,
        };
      }
      return existing;
    }

    return this.db
      .insert(environments)
      .values({ name, displayName, production: production ?? false })
      .returning()
      .get();
  }

  async getEnvironment(name: string): Promise<Environment | undefined> {
    return this.db.select().from(environments).where(eq(environments.name, name)).get();
  }

  async getAllEnvironments(): Promise<Environment[]> {
    return this.db.select().from(environments).all();
  }

  // ============ Deployment Operations ============

  async recordDeployment(
    pacticipantName: string,
    versionNumber: string,
    environmentName: string,
  ): Promise<DeployedVersion | null> {
    const version = await this.getVersion(pacticipantName, versionNumber);
    if (!version) return null;

    const environment = await this.getOrCreateEnvironment(environmentName);

    // Check if already deployed (and not undeployed)
    const existing = this.db
      .select()
      .from(deployedVersions)
      .where(
        and(
          eq(deployedVersions.versionId, version.id),
          eq(deployedVersions.environmentId, environment.id),
          isNull(deployedVersions.undeployedAt),
        ),
      )
      .get();

    if (existing) return existing;

    // If there was a previous deployment that was undeployed, create a new record
    return this.db
      .insert(deployedVersions)
      .values({
        versionId: version.id,
        environmentId: environment.id,
      })
      .returning()
      .get();
  }

  async recordUndeployment(
    pacticipantName: string,
    versionNumber: string,
    environmentName: string,
  ): Promise<boolean> {
    const version = await this.getVersion(pacticipantName, versionNumber);
    if (!version) return false;

    const environment = await this.getEnvironment(environmentName);
    if (!environment) return false;

    // Check if there's an active deployment first
    const existing = this.db
      .select()
      .from(deployedVersions)
      .where(
        and(
          eq(deployedVersions.versionId, version.id),
          eq(deployedVersions.environmentId, environment.id),
          isNull(deployedVersions.undeployedAt),
        ),
      )
      .get();

    if (!existing) return false;

    this.db
      .update(deployedVersions)
      .set({
        undeployedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
      })
      .where(eq(deployedVersions.id, existing.id))
      .run();

    return true;
  }

  async getDeploymentsForVersion(
    pacticipantName: string,
    versionNumber: string,
  ): Promise<Array<{ deployment: DeployedVersion; environment: Environment }>> {
    const version = await this.getVersion(pacticipantName, versionNumber);
    if (!version) return [];

    const results = this.db
      .select({
        deployment: deployedVersions,
        environment: environments,
      })
      .from(deployedVersions)
      .innerJoin(environments, eq(deployedVersions.environmentId, environments.id))
      .where(eq(deployedVersions.versionId, version.id))
      .all();

    return results;
  }

  async isVersionDeployed(
    pacticipantName: string,
    versionNumber: string,
    environmentName?: string,
  ): Promise<boolean> {
    const version = await this.getVersion(pacticipantName, versionNumber);
    if (!version) return false;

    if (environmentName) {
      const environment = await this.getEnvironment(environmentName);
      if (!environment) return false;

      const deployment = this.db
        .select()
        .from(deployedVersions)
        .where(
          and(
            eq(deployedVersions.versionId, version.id),
            eq(deployedVersions.environmentId, environment.id),
            isNull(deployedVersions.undeployedAt),
          ),
        )
        .get();

      return !!deployment;
    }

    // Check if deployed to any environment
    const deployment = this.db
      .select()
      .from(deployedVersions)
      .where(and(eq(deployedVersions.versionId, version.id), isNull(deployedVersions.undeployedAt)))
      .get();

    return !!deployment;
  }

  // ============ Pacts For Verification ============

  async getPactsForVerification(
    providerName: string,
    selectors: ConsumerVersionSelector[],
  ): Promise<
    Array<{
      pact: Pact;
      consumer: Pacticipant;
      provider: Pacticipant;
      version: Version;
      notices: string[];
    }>
  > {
    const provider = await this.getPacticipant(providerName);
    if (!provider) return [];

    // Start with all latest pacts for this provider
    let results = await this.getLatestPactsForProvider(providerName);

    // If no selectors, default to latest
    if (!selectors || selectors.length === 0) {
      return results.map((r) => ({
        ...r,
        notices: ["This pact is being verified because it is the latest pact"],
      }));
    }

    const matchedPacts: Map<
      number,
      {
        pact: Pact;
        consumer: Pacticipant;
        provider: Pacticipant;
        version: Version;
        notices: string[];
      }
    > = new Map();

    for (const selector of selectors) {
      let selectorResults = results;
      const notices: string[] = [];

      // Filter by consumer
      if (selector.consumer) {
        selectorResults = selectorResults.filter((r) => r.consumer.name === selector.consumer);
        notices.push(`consumer is ${selector.consumer}`);
      }

      // Filter by tag
      if (selector.tag) {
        const filteredByTag: typeof selectorResults = [];
        for (const r of selectorResults) {
          const versionTags = await this.getTagsForVersion(r.consumer.name, r.version.number);
          if (versionTags.some((t) => t.name === selector.tag)) {
            filteredByTag.push(r);
          }
        }
        selectorResults = filteredByTag;
        notices.push(`version tagged with '${selector.tag}'`);
      }

      // Filter by branch
      if (selector.branch) {
        selectorResults = selectorResults.filter((r) => r.version.branch === selector.branch);
        notices.push(`version is on branch '${selector.branch}'`);
      }

      // Filter by mainBranch
      if (selector.mainBranch) {
        const filteredByMainBranch: typeof selectorResults = [];
        for (const r of selectorResults) {
          const consumer = await this.getPacticipant(r.consumer.name);
          if (consumer && r.version.branch === consumer.mainBranch) {
            filteredByMainBranch.push(r);
          }
        }
        selectorResults = filteredByMainBranch;
        notices.push("version is on the main branch");
      }

      // Filter by deployed
      if (selector.deployed) {
        const filteredByDeployed: typeof selectorResults = [];
        for (const r of selectorResults) {
          const isDeployed = await this.isVersionDeployed(
            r.consumer.name,
            r.version.number,
            selector.environment,
          );
          if (isDeployed) {
            filteredByDeployed.push(r);
          }
        }
        selectorResults = filteredByDeployed;
        notices.push(
          selector.environment
            ? `version is deployed to '${selector.environment}'`
            : "version is currently deployed",
        );
      }

      // Latest selector just uses current results
      if (selector.latest) {
        notices.push("it is the latest pact");
      }

      // Add matched pacts with notices
      for (const r of selectorResults) {
        const existing = matchedPacts.get(r.pact.id);
        if (existing) {
          existing.notices.push(...notices);
        } else {
          matchedPacts.set(r.pact.id, {
            ...r,
            notices: notices.length > 0 ? notices : ["it matches the consumer version selectors"],
          });
        }
      }
    }

    return Array.from(matchedPacts.values());
  }

  // ============ Webhook Operations ============

  async createWebhook(input: {
    events: WebhookEvent[];
    url: string;
    method?: string;
    headers?: Record<string, string> | null;
    body?: string | null;
    consumer?: string | null;
    provider?: string | null;
    enabled?: boolean;
    description?: string | null;
  }): Promise<Webhook> {
    const consumerId = input.consumer
      ? (await this.getOrCreatePacticipant(input.consumer)).id
      : null;
    const providerId = input.provider
      ? (await this.getOrCreatePacticipant(input.provider)).id
      : null;

    return this.db
      .insert(webhooks)
      .values({
        consumerId,
        providerId,
        events: input.events.join(","),
        url: input.url,
        method: input.method ?? "POST",
        headers: input.headers ? JSON.stringify(input.headers) : null,
        body: input.body ?? null,
        enabled: input.enabled ?? true,
        description: input.description ?? null,
      })
      .returning()
      .get();
  }

  async updateWebhook(
    id: number,
    input: Partial<{
      events: WebhookEvent[];
      url: string;
      method: string;
      headers: Record<string, string> | null;
      body: string | null;
      consumer: string | null;
      provider: string | null;
      enabled: boolean;
      description: string | null;
    }>,
  ): Promise<Webhook | null> {
    const existing = this.db.select().from(webhooks).where(eq(webhooks.id, id)).get();
    if (!existing) return null;

    const consumerId =
      input.consumer === undefined
        ? existing.consumerId
        : input.consumer === null
          ? null
          : (await this.getOrCreatePacticipant(input.consumer)).id;
    const providerId =
      input.provider === undefined
        ? existing.providerId
        : input.provider === null
          ? null
          : (await this.getOrCreatePacticipant(input.provider)).id;

    this.db
      .update(webhooks)
      .set({
        consumerId,
        providerId,
        ...(input.events !== undefined && { events: input.events.join(",") }),
        ...(input.url !== undefined && { url: input.url }),
        ...(input.method !== undefined && { method: input.method }),
        ...(input.headers !== undefined && {
          headers: input.headers ? JSON.stringify(input.headers) : null,
        }),
        ...(input.body !== undefined && { body: input.body }),
        ...(input.enabled !== undefined && { enabled: input.enabled }),
        ...(input.description !== undefined && { description: input.description }),
      })
      .where(eq(webhooks.id, id))
      .run();

    return this.db.select().from(webhooks).where(eq(webhooks.id, id)).get() ?? null;
  }

  async deleteWebhook(id: number): Promise<boolean> {
    const existing = this.db.select().from(webhooks).where(eq(webhooks.id, id)).get();
    if (!existing) return false;
    this.db.delete(webhooks).where(eq(webhooks.id, id)).run();
    return true;
  }

  async getWebhook(id: number): Promise<{
    webhook: Webhook;
    consumer: Pacticipant | null;
    provider: Pacticipant | null;
  } | null> {
    const hook = this.db.select().from(webhooks).where(eq(webhooks.id, id)).get();
    if (!hook) return null;
    const consumer = hook.consumerId
      ? (this.db.select().from(pacticipants).where(eq(pacticipants.id, hook.consumerId)).get() ??
        null)
      : null;
    const provider = hook.providerId
      ? (this.db.select().from(pacticipants).where(eq(pacticipants.id, hook.providerId)).get() ??
        null)
      : null;
    return { webhook: hook, consumer, provider };
  }

  async listWebhooks(): Promise<
    Array<{
      webhook: Webhook;
      consumer: Pacticipant | null;
      provider: Pacticipant | null;
    }>
  > {
    const all = this.db.select().from(webhooks).all();
    const results: Array<{
      webhook: Webhook;
      consumer: Pacticipant | null;
      provider: Pacticipant | null;
    }> = [];
    for (const hook of all) {
      const consumer = hook.consumerId
        ? (this.db.select().from(pacticipants).where(eq(pacticipants.id, hook.consumerId)).get() ??
          null)
        : null;
      const provider = hook.providerId
        ? (this.db.select().from(pacticipants).where(eq(pacticipants.id, hook.providerId)).get() ??
          null)
        : null;
      results.push({ webhook: hook, consumer, provider });
    }
    return results;
  }

  async getWebhookExecutions(webhookId: number, limit = 50): Promise<WebhookExecution[]> {
    return this.db
      .select()
      .from(webhookExecutions)
      .where(eq(webhookExecutions.webhookId, webhookId))
      .orderBy(desc(webhookExecutions.executedAt))
      .limit(limit)
      .all();
  }

  // Build the default payload sent when a webhook has no body template.
  private buildDefaultPayload(
    event: WebhookEvent,
    ctx: {
      consumer: Pacticipant;
      provider: Pacticipant;
      consumerVersion?: Version;
      pact?: Pact;
      verification?: Verification;
      providerVersion?: Version;
    },
  ): WebhookEventPayload {
    const payload: WebhookEventPayload = {
      event,
      triggeredAt: new Date().toISOString(),
      consumer: { name: ctx.consumer.name },
      provider: { name: ctx.provider.name },
    };
    if (ctx.consumerVersion) payload.consumerVersion = ctx.consumerVersion.number;
    if (ctx.pact && ctx.consumerVersion) {
      payload.pact = {
        contentSha: ctx.pact.contentSha,
        url: `/pacts/provider/${encodeURIComponent(ctx.provider.name)}/consumer/${encodeURIComponent(ctx.consumer.name)}/pact-version/${ctx.pact.contentSha}`,
      };
    }
    if (ctx.verification && ctx.providerVersion) {
      payload.verification = {
        success: ctx.verification.success,
        providerVersion: ctx.providerVersion.number,
        verifiedAt: ctx.verification.verifiedAt,
        buildUrl: ctx.verification.buildUrl ?? null,
      };
    }
    return payload;
  }

  // Very small template expander: replaces ${path.to.key} lookups in JSON-string bodies.
  private renderTemplate(template: string, payload: WebhookEventPayload): string {
    return template.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
      const parts = expr.trim().split(".");
      let cursor: unknown = payload;
      for (const p of parts) {
        if (cursor && typeof cursor === "object" && p in (cursor as Record<string, unknown>)) {
          cursor = (cursor as Record<string, unknown>)[p];
        } else {
          return "";
        }
      }
      return typeof cursor === "string" ? cursor : JSON.stringify(cursor);
    });
  }

  private async fireWebhook(
    hook: Webhook,
    event: WebhookEvent,
    triggeredBy: string,
    payload: WebhookEventPayload,
  ): Promise<void> {
    let headers: Record<string, string> = { "Content-Type": "application/json" };
    if (hook.headers) {
      try {
        headers = { ...headers, ...(JSON.parse(hook.headers) as Record<string, string>) };
      } catch {
        // ignore bad stored headers
      }
    }
    const body = hook.body ? this.renderTemplate(hook.body, payload) : JSON.stringify(payload);

    for (let attempt = 1; attempt <= WEBHOOK_RETRY_DELAYS_MS.length; attempt++) {
      let status: number | null = null;
      let respBody: string | null = null;
      let error: string | null = null;
      let succeeded = false;
      try {
        const res = await fetch(hook.url, { method: hook.method, headers, body });
        status = res.status;
        const text = await res.text();
        respBody =
          text.length > MAX_WEBHOOK_RESPONSE_BYTES
            ? text.slice(0, MAX_WEBHOOK_RESPONSE_BYTES)
            : text;
        succeeded = res.ok;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }

      this.db
        .insert(webhookExecutions)
        .values({
          webhookId: hook.id,
          event,
          triggeredBy,
          requestUrl: hook.url,
          requestMethod: hook.method,
          responseStatus: status,
          responseBody: respBody,
          attempt,
          succeeded,
          error,
        })
        .run();

      if (succeeded) return;
      if (attempt < WEBHOOK_RETRY_DELAYS_MS.length) {
        await new Promise((r) => setTimeout(r, WEBHOOK_RETRY_DELAYS_MS[attempt - 1]));
      }
    }
  }

  private matchingWebhooks(
    event: WebhookEvent,
    consumerId: number | null,
    providerId: number | null,
  ): Webhook[] {
    const all = this.db.select().from(webhooks).where(eq(webhooks.enabled, true)).all();
    return all.filter((h) => {
      const eventList = h.events.split(",").map((s) => s.trim());
      if (!eventList.includes(event)) return false;
      if (h.consumerId !== null && h.consumerId !== consumerId) return false;
      if (h.providerId !== null && h.providerId !== providerId) return false;
      return true;
    });
  }

  // Dispatch without blocking the caller. Safe to ctx.waitUntil() from the outside.
  async dispatchContractPublished(pactId: number, triggeredBy: string): Promise<void> {
    const pact = this.db.select().from(pacts).where(eq(pacts.id, pactId)).get();
    if (!pact) return;
    const version = this.db
      .select()
      .from(versions)
      .where(eq(versions.id, pact.consumerVersionId))
      .get();
    if (!version) return;
    const consumer = this.db
      .select()
      .from(pacticipants)
      .where(eq(pacticipants.id, version.pacticipantId))
      .get();
    const provider = this.db
      .select()
      .from(pacticipants)
      .where(eq(pacticipants.id, pact.providerId))
      .get();
    if (!consumer || !provider) return;

    const hooks = this.matchingWebhooks("contract_published", consumer.id, provider.id);
    if (hooks.length === 0) return;

    const payload = this.buildDefaultPayload("contract_published", {
      consumer,
      provider,
      consumerVersion: version,
      pact,
    });

    await Promise.all(
      hooks.map((h) => this.fireWebhook(h, "contract_published", triggeredBy, payload)),
    );
  }

  async dispatchVerificationPublished(verificationId: number, triggeredBy: string): Promise<void> {
    const verification = this.db
      .select()
      .from(verifications)
      .where(eq(verifications.id, verificationId))
      .get();
    if (!verification) return;
    const pact = this.db.select().from(pacts).where(eq(pacts.id, verification.pactId)).get();
    if (!pact) return;
    const providerVersion = this.db
      .select()
      .from(versions)
      .where(eq(versions.id, verification.providerVersionId))
      .get();
    const consumerVersion = this.db
      .select()
      .from(versions)
      .where(eq(versions.id, pact.consumerVersionId))
      .get();
    if (!providerVersion || !consumerVersion) return;
    const consumer = this.db
      .select()
      .from(pacticipants)
      .where(eq(pacticipants.id, consumerVersion.pacticipantId))
      .get();
    const provider = this.db
      .select()
      .from(pacticipants)
      .where(eq(pacticipants.id, pact.providerId))
      .get();
    if (!consumer || !provider) return;

    const hooks = this.matchingWebhooks(
      "provider_verification_published",
      consumer.id,
      provider.id,
    );
    if (hooks.length === 0) return;

    const payload = this.buildDefaultPayload("provider_verification_published", {
      consumer,
      provider,
      consumerVersion,
      pact,
      verification,
      providerVersion,
    });

    await Promise.all(
      hooks.map((h) =>
        this.fireWebhook(h, "provider_verification_published", triggeredBy, payload),
      ),
    );
  }

  async executeWebhookManually(webhookId: number): Promise<{ fired: boolean; reason?: string }> {
    const hook = this.db.select().from(webhooks).where(eq(webhooks.id, webhookId)).get();
    if (!hook) return { fired: false, reason: "not found" };
    if (!hook.enabled) return { fired: false, reason: "webhook is disabled" };

    const eventList = hook.events.split(",").map((s) => s.trim()) as WebhookEvent[];
    const event = eventList[0] ?? "contract_published";

    const payload: WebhookEventPayload = {
      event,
      triggeredAt: new Date().toISOString(),
      consumer: { name: "manual-trigger" },
      provider: { name: "manual-trigger" },
    };
    await this.fireWebhook(hook, event, "manual", payload);
    return { fired: true };
  }

  // ============ Utilities ============

  private async sha256(content: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
}
