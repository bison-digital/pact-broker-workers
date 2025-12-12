import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Pacticipants (consumers and providers)
export const pacticipants = sqliteTable(
  "pacticipants",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull().unique(),
    mainBranch: text("main_branch").default("main"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [index("pacticipants_name_idx").on(table.name)]
);

// Versions of pacticipants
export const versions = sqliteTable(
  "versions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    pacticipantId: integer("pacticipant_id")
      .notNull()
      .references(() => pacticipants.id, { onDelete: "cascade" }),
    number: text("number").notNull(), // Version string (e.g., "1.0.0", git SHA)
    branch: text("branch"), // Optional branch name
    buildUrl: text("build_url"), // Optional CI build URL
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    uniqueIndex("versions_pacticipant_number_idx").on(
      table.pacticipantId,
      table.number
    ),
    index("versions_pacticipant_id_idx").on(table.pacticipantId),
  ]
);

// Tags for versions (e.g., "prod", "main", "feature-x")
export const tags = sqliteTable(
  "tags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    versionId: integer("version_id")
      .notNull()
      .references(() => versions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    uniqueIndex("tags_version_name_idx").on(table.versionId, table.name),
    index("tags_name_idx").on(table.name),
  ]
);

// Pacts (contracts between consumer and provider)
export const pacts = sqliteTable(
  "pacts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    consumerVersionId: integer("consumer_version_id")
      .notNull()
      .references(() => versions.id, { onDelete: "cascade" }),
    providerId: integer("provider_id")
      .notNull()
      .references(() => pacticipants.id, { onDelete: "cascade" }),
    content: text("content").notNull(), // JSON content of the pact
    contentSha: text("content_sha").notNull(), // SHA-256 of content for deduplication
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    uniqueIndex("pacts_consumer_version_provider_idx").on(
      table.consumerVersionId,
      table.providerId
    ),
    index("pacts_provider_id_idx").on(table.providerId),
    index("pacts_content_sha_idx").on(table.contentSha),
  ]
);

// Verification results (provider verifying a pact)
export const verifications = sqliteTable(
  "verifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    pactId: integer("pact_id")
      .notNull()
      .references(() => pacts.id, { onDelete: "cascade" }),
    providerVersionId: integer("provider_version_id")
      .notNull()
      .references(() => versions.id, { onDelete: "cascade" }),
    success: integer("success", { mode: "boolean" }).notNull(),
    buildUrl: text("build_url"),
    verifiedAt: text("verified_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index("verifications_pact_id_idx").on(table.pactId),
    index("verifications_provider_version_idx").on(table.providerVersionId),
  ]
);

// Environments (e.g., "prod", "staging", "dev")
export const environments = sqliteTable(
  "environments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull().unique(),
    displayName: text("display_name"),
    production: integer("production", { mode: "boolean" }).default(false),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [index("environments_name_idx").on(table.name)]
);

// Deployed versions (tracks which versions are deployed to which environments)
export const deployedVersions = sqliteTable(
  "deployed_versions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    versionId: integer("version_id")
      .notNull()
      .references(() => versions.id, { onDelete: "cascade" }),
    environmentId: integer("environment_id")
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    deployedAt: text("deployed_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    undeployedAt: text("undeployed_at"), // NULL = currently deployed
  },
  (table) => [
    index("deployed_versions_env_idx").on(table.environmentId),
    index("deployed_versions_version_idx").on(table.versionId),
    uniqueIndex("deployed_versions_version_env_idx").on(
      table.versionId,
      table.environmentId
    ),
  ]
);

// Type exports for use in services
export type Pacticipant = typeof pacticipants.$inferSelect;
export type NewPacticipant = typeof pacticipants.$inferInsert;

export type Version = typeof versions.$inferSelect;
export type NewVersion = typeof versions.$inferInsert;

export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;

export type Pact = typeof pacts.$inferSelect;
export type NewPact = typeof pacts.$inferInsert;

export type Verification = typeof verifications.$inferSelect;
export type NewVerification = typeof verifications.$inferInsert;

export type Environment = typeof environments.$inferSelect;
export type NewEnvironment = typeof environments.$inferInsert;

export type DeployedVersion = typeof deployedVersions.$inferSelect;
export type NewDeployedVersion = typeof deployedVersions.$inferInsert;
