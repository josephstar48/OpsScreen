import { Pool } from "pg";
import { attachDatabasePool } from "@vercel/functions";

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "Missing database connection string. Set POSTGRES_URL or DATABASE_URL in Vercel project settings."
  );
}

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
});

attachDatabasePool(pool);

let schemaPromise;

export async function query(text, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

export async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = createSchema();
  }
  return schemaPromise;
}

async function createSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS opsscreen_records (
      record_id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL,
      scenario_name TEXT NOT NULL,
      intake_date TIMESTAMPTZ NOT NULL,
      current_status TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS opsscreen_audit_log (
      id BIGSERIAL PRIMARY KEY,
      action TEXT NOT NULL,
      record_id TEXT NOT NULL,
      actor TEXT NOT NULL,
      source_ip TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_opsscreen_records_updated_at
      ON opsscreen_records (updated_at DESC);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_opsscreen_audit_log_created_at
      ON opsscreen_audit_log (created_at DESC);
  `);
}

export async function appendAuditEntry(action, recordId, actor, sourceIp) {
  await ensureSchema();
  await query(
    `
      INSERT INTO opsscreen_audit_log (action, record_id, actor, source_ip)
      VALUES ($1, $2, $3, $4)
    `,
    [action, recordId, actor, sourceIp]
  );
}
