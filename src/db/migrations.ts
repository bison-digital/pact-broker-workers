import type { SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";

// SQL migrations to run in the Durable Object constructor
// These are idempotent (use IF NOT EXISTS)
const migrations = [
  // v1: Initial schema
  `CREATE TABLE IF NOT EXISTS pacticipants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS pacticipants_name_idx ON pacticipants(name)`,

  `CREATE TABLE IF NOT EXISTS versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pacticipant_id INTEGER NOT NULL REFERENCES pacticipants(id) ON DELETE CASCADE,
    number TEXT NOT NULL,
    branch TEXT,
    build_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(pacticipant_id, number)
  )`,
  `CREATE INDEX IF NOT EXISTS versions_pacticipant_id_idx ON versions(pacticipant_id)`,

  `CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version_id INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(version_id, name)
  )`,
  `CREATE INDEX IF NOT EXISTS tags_name_idx ON tags(name)`,

  `CREATE TABLE IF NOT EXISTS pacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    consumer_version_id INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
    provider_id INTEGER NOT NULL REFERENCES pacticipants(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    content_sha TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(consumer_version_id, provider_id)
  )`,
  `CREATE INDEX IF NOT EXISTS pacts_provider_id_idx ON pacts(provider_id)`,
  `CREATE INDEX IF NOT EXISTS pacts_content_sha_idx ON pacts(content_sha)`,

  `CREATE TABLE IF NOT EXISTS verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pact_id INTEGER NOT NULL REFERENCES pacts(id) ON DELETE CASCADE,
    provider_version_id INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
    success INTEGER NOT NULL,
    build_url TEXT,
    verified_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS verifications_pact_id_idx ON verifications(pact_id)`,
  `CREATE INDEX IF NOT EXISTS verifications_provider_version_idx ON verifications(provider_version_id)`,
];

/**
 * Run migrations on the Durable Object's SQLite database.
 * Called from the DO constructor - must be synchronous.
 */
export function runMigrations(sql: SqlStorage): void {
  for (const migration of migrations) {
    sql.exec(migration);
  }
}

/**
 * Alternative: Run migrations using Drizzle (for if we need more complex migrations)
 */
export async function runMigrationsDrizzle(
  db: SqliteRemoteDatabase
): Promise<void> {
  for (const migration of migrations) {
    await db.run(migration as unknown as Parameters<typeof db.run>[0]);
  }
}
