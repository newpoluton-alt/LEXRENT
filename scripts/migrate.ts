import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { neon } from "@neondatabase/serverless";

async function migrate() {
  // loadEnvFile preserves existing environment values. Never print secrets.
  for (const filename of [".env.local", ".env"]) {
    try {
      loadEnvFile(path.join(process.cwd(), filename));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required to run migrations.");
  const sql = neon(databaseUrl);
  await sql.query(`CREATE TABLE IF NOT EXISTS lexrent_schema_migrations (
    name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const migrationDirectory = path.join(process.cwd(), "migrations");
  const filenames = (await readdir(migrationDirectory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  for (const name of filenames) {
    const contents = await readFile(path.join(migrationDirectory, name), "utf8");
    const sha256 = createHash("sha256").update(contents).digest("hex");
    const applied = await sql.query("SELECT sha256 FROM lexrent_schema_migrations WHERE name = $1", [name]);
    if (applied.length) {
      if (applied[0].sha256 !== sha256) throw new Error(`Applied migration ${name} has changed. Add a new migration instead.`);
      console.info(`Already applied: ${name}`);
      continue;
    }
    // These migrations intentionally contain only ordinary additive DDL, without
    // dollar-quoted routines. Statements run together in an atomic transaction.
    const statements = contents.split(";").map((statement) => statement.trim()).filter(Boolean);
    await sql.transaction([
      sql.query("SELECT pg_advisory_xact_lock($1)", [197504]),
      ...statements.map((statement) => sql.query(statement)),
      sql.query("INSERT INTO lexrent_schema_migrations (name, sha256) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING", [name, sha256]),
    ]);
    console.info(`Applied: ${name}`);
  }
}

migrate().catch((error: unknown) => {
  // Driver exceptions may contain connection details; report only actionable,
  // controlled messages rather than dumping the database error or environment.
  const message = error instanceof Error && (
    error.message.startsWith("DATABASE_URL is required") ||
    error.message.startsWith("Applied migration ")
  ) ? error.message : "Migration failed. Check database access and the migration SQL.";
  console.error(message);
  process.exitCode = 1;
});
