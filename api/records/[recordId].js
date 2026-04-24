import { appendAuditEntry, ensureSchema, getUserContext, query } from "../../lib/db.js";
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
    validateRecord(payload, true);
    const actorContext = await getActor(payload.actorUserId || payload.createdBy);

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

    assertCanModifyRecord(actorContext, current.rows[0].org_id, current.rows[0].created_by);
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
    const url = new URL(request.url);
    const actorContext = await getActor(url.searchParams.get("actorUserId"));

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

async function getActor(actorUserId) {
  if (!actorUserId) {
    throw new HttpError("Actor user is required.", 400);
  }
  const actorContext = await getUserContext(actorUserId);
  if (!actorContext?.user?.active) {
    throw new HttpError("Acting user is invalid or inactive.", 403);
  }
  return actorContext;
}

function assertCanModifyRecord(actorContext, orgId, createdBy) {
  if (actorContext.user.platformRole === "super_admin") {
    return;
  }

  const adminMembership = actorContext.memberships.find(
    (item) => item.orgId === orgId && item.active && item.orgRole === "org_admin"
  );
  if (adminMembership) {
    return;
  }

  if (actorContext.user.userId !== createdBy) {
    throw new HttpError("You may only change your own records.", 403);
  }
}
