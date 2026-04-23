import { ensureSchema, query, appendAuditEntry } from "../../lib/db.js";
import { error, HttpError, json, parseJson } from "../../lib/http.js";
import { normalizeRecord, validateRecord } from "../../lib/record-utils.js";

export const config = {
  runtime: "nodejs",
};

export async function GET() {
  await ensureSchema();
  const result = await query(`
    SELECT payload
    FROM opsscreen_records
    ORDER BY updated_at DESC
  `);

  return json({
    records: result.rows.map((row) => row.payload),
    total: result.rowCount,
  });
}

export async function POST(request) {
  try {
    const payload = await parseJson(request);
    validateRecord(payload, false);
    await ensureSchema();

    const record = normalizeRecord(payload, false);

    await query(
      `
        INSERT INTO opsscreen_records (
          record_id,
          subject_id,
          scenario_name,
          intake_date,
          current_status,
          payload,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
      `,
      [
        record.recordId,
        record.subjectId,
        record.scenarioName,
        record.intakeDate,
        record.currentStatus || "Awaiting processing",
        JSON.stringify(record),
        record.createdAt,
        record.updatedAt,
      ]
    );

    await appendAuditEntry(
      "create",
      record.recordId,
      request.headers.get("x-opsscreen-user") || "vercel-training-user",
      request.headers.get("x-forwarded-for") || "unknown"
    );

    return json({ record }, { status: 201 });
  } catch (caught) {
    const status = caught instanceof HttpError ? caught.status : 400;
    return error(caught.message || "Failed to create record.", status);
  }
}
