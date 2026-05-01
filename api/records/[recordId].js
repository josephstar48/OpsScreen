import { appendAuditEntry, ensureSchema, query } from "../../lib/db.js";
import { requireAuth } from "../../lib/auth.js";
import { error, HttpError, json, parseJson } from "../../lib/http.js";
import { normalizeRecord, validateRecord } from "../../lib/record-utils.js";

export const config = {
  runtime: "nodejs",
};

export async function PUT(request) {
  try {
    await ensureSchema();
    const recordId = extractRecordId(request);
    const payload = await parseJson(request);
    payload.recordId = recordId;
    const actorContext = await requireAuth(request);

    const current = await query(
      `
        SELECT payload, org_id, created_by
        FROM opsscreen_records
        WHERE record_id = $1
      `,
      [recordId]
    );

    if (!current.rowCount) {
      return error("Record not found.", 404);
    }

    payload.createdBy = current.rows[0].created_by;
    payload.orgId = current.rows[0].org_id;
    validateRecord(payload, true);
    assertCanModifyRecord(actorContext, current.rows[0].org_id, current.rows[0].created_by, payload.scenarioId);
    const record = normalizeRecord({ ...current.rows[0].payload, ...payload, recordId }, true);

    await query(
      `
        UPDATE opsscreen_records
        SET
          org_id = $2,
          scenario_id = $3,
          created_by = $4,
          subject_id = $5,
          scenario_name = $6,
          intake_date = $7,
          current_status = $8,
          payload = $9::jsonb,
          updated_at = $10
        WHERE record_id = $1
      `,
      [
        record.recordId,
        record.orgId,
        record.scenarioId,
        record.createdBy,
        record.subjectId,
        record.scenarioName,
        record.intakeDate,
        record.currentStatus,
        JSON.stringify(record),
        record.updatedAt,
      ]
    );

    await appendAuditEntry({
      action: "update",
      entityType: "record",
      entityId: record.recordId,
      orgId: record.orgId,
      actor: actorContext.user.userId,
      sourceIp: request.headers.get("x-forwarded-for") || "unknown",
      details: { scenarioId: record.scenarioId },
    });

    return json({ record });
  } catch (caught) {
    const status = caught instanceof HttpError ? caught.status : 400;
    return error(caught.message || "Failed to update record.", status);
  }
}

export async function DELETE(request) {
  try {
    await ensureSchema();
    const recordId = extractRecordId(request);
    const actorContext = await requireAuth(request);

    const current = await query(
      `
        SELECT org_id, created_by
        FROM opsscreen_records
        WHERE record_id = $1
      `,
      [recordId]
    );

    if (!current.rowCount) {
      return error("Record not found.", 404);
    }

    assertCanModifyRecord(actorContext, current.rows[0].org_id, current.rows[0].created_by);

    await query(
      `
        DELETE FROM opsscreen_records
        WHERE record_id = $1
      `,
      [recordId]
    );

    await appendAuditEntry({
      action: "delete",
      entityType: "record",
      entityId: recordId,
      orgId: current.rows[0].org_id,
      actor: actorContext.user.userId,
      sourceIp: request.headers.get("x-forwarded-for") || "unknown",
      details: {},
    });

    return json({ ok: true });
  } catch (caught) {
    const status = caught instanceof HttpError ? caught.status : 400;
    return error(caught.message || "Failed to delete record.", status);
  }
}

function extractRecordId(request) {
  const url = new URL(request.url);
  return decodeURIComponent(url.pathname.split("/").pop() || "");
}

function assertCanModifyRecord(actorContext, orgId, createdBy, scenarioId = null) {
  if (actorContext.user.platformRole === "super_admin") {
    return;
  }

  const membership = actorContext.memberships.find((item) => item.orgId === orgId && item.active);
  if (membership?.orgRole === "org_admin") {
    return;
  }

  if (!membership) {
    throw new HttpError("You must be an active member of this organization to change this record.", 403);
  }
  if (actorContext.user.userId !== createdBy) {
    throw new HttpError("You may only change your own records.", 403);
  }
  if (scenarioId) {
    const scenarioMembership = actorContext.scenarioMemberships.find(
      (item) => item.scenarioId === scenarioId && item.active
    );
    if (!scenarioMembership) {
      throw new HttpError("You must be an active scenario member to update this record.", 403);
    }
  }
}
