import { ensureSchema, query } from "../lib/db.js";
import { json } from "../lib/http.js";

export const config = {
  runtime: "nodejs",
};

export async function GET() {
  await ensureSchema();
  const result = await query(`
    SELECT id, action, record_id, actor, source_ip, created_at
    FROM opsscreen_audit_log
    ORDER BY created_at DESC
    LIMIT 100
  `);

  return json({
    entries: result.rows.map((row) => ({
      id: row.id,
      action: row.action,
      recordId: row.record_id,
      actor: row.actor,
      sourceIp: row.source_ip,
      createdAt: row.created_at,
    })),
  });
}
