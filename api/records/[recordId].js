import { ensureSchema, query, appendAuditEntry } from "../../lib/db.js";
import { error, HttpError, json, parseJson } from "../../lib/http.js";
import { normalizeRecord, validateRecord } from "../../lib/record-utils.js";

export const config = {
  runtime: "nodejs",
};

function extractRecordId(request) {
  const url = new URL(request.url);
  return decodeURIComponent(url.pathname.split("/").pop() || "");
}

export async function PUT(request) {
  try {
    const recordId = extractRecordId(request);
    const payload = await parseJson(request);
    payload.recordId = recordId;
    validateRecord(payload, true);
    await ensureSchema();

    const current = await query(
      `
        SELECT payload
        FROM opsscreen_records
        WHERE record_id = $1
      `,
      [recordId]
    );

    if (!current.rowCount) {
      return error("Record not found.", 404);
    }

    const record = normalizeRecord(
      { ...current.rows[0].payload, ...payload, recordId },
      true
    );

    await query(
      `
        UPDATE opsscreen_records
        SET
          subject_id = $2,
          scenario_name = $3,
          intake_date = $4,
          current_status = $5,
          payload = $6::jsonb,
          updated_at = $7
        WHERE record_id = $1
      `,
      [
        record.recordId,
        record.subjectId,
        record.scenarioName,
        record.intakeDate,
        record.currentStatus || "Awaiting processing",
        JSON.stringify(record),
        record.updatedAt,
      ]
    );

    await appendAuditEntry(
      "update",
      record.recordId,
      request.headers.get("x-opsscreen-user") || "vercel-training-user",
      request.headers.get("x-forwarded-for") || "unknown"
    );

    return json({ record });
  } catch (caught) {
    const status = caught instanceof HttpError ? caught.status : 400;
    return error(caught.message || "Failed to update record.", status);
  }
}

export async function DELETE(request) {
  const recordId = extractRecordId(request);
  await ensureSchema();

  const result = await query(
    `
      DELETE FROM opsscreen_records
      WHERE record_id = $1
    `,
    [recordId]
  );

  if (!result.rowCount) {
    return error("Record not found.", 404);
  }

  await appendAuditEntry(
    "delete",
    recordId,
    request.headers.get("x-opsscreen-user") || "vercel-training-user",
    request.headers.get("x-forwarded-for") || "unknown"
  );

  return json({ ok: true });
}
