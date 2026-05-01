import { ensureSchema, query, appendAuditEntry } from "../../lib/db.js";
import { requireAuth } from "../../lib/auth.js";
import { error, HttpError, json, parseJson } from "../../lib/http.js";
import { normalizeRecord, validateRecord } from "../../lib/record-utils.js";

export const config = {
  runtime: "nodejs",
};

export async function GET(request) {
  try {
    await ensureSchema();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const scenarioId = url.searchParams.get("scenarioId");
    const actorContext = await requireAuth(request);

    let sql = `
      SELECT payload
      FROM opsscreen_records
      WHERE 1 = 1
    `;
    const params = [];

    if (orgId) {
      params.push(orgId);
      sql += ` AND org_id = $${params.length}`;
    }

    if (scenarioId) {
      params.push(scenarioId);
      sql += ` AND scenario_id = $${params.length}`;
    }

    if (actorContext.user.platformRole !== "super_admin") {
      const activeOrgIds = actorContext.memberships.filter((item) => item.active).map((item) => item.orgId);
      if (!activeOrgIds.length) {
        return json({ records: [], total: 0 });
      }

      const adminOrgIds = actorContext.memberships
        .filter((item) => item.active && item.orgRole === "org_admin")
        .map((item) => item.orgId);

      if (adminOrgIds.length) {
        params.push(adminOrgIds);
        const adminParam = params.length;
        params.push(actorContext.user.userId);
        const userParam = params.length;
        sql += ` AND (org_id = ANY($${adminParam}::text[]) OR created_by = $${userParam})`;
      } else {
        params.push(actorContext.user.userId);
        sql += ` AND created_by = $${params.length}`;
      }
    }

    sql += ` ORDER BY updated_at DESC`;
    const result = await query(sql, params);

    return json({
      records: result.rows.map((row) => row.payload),
      total: result.rowCount,
    });
  } catch (caught) {
    const status = caught instanceof HttpError ? caught.status : 400;
    return error(caught.message || "Failed to load records.", status);
  }
}

export async function POST(request) {
  try {
    await ensureSchema();
    const payload = await parseJson(request);
    const actorContext = await requireAuth(request);
    payload.createdBy = actorContext.user.userId;
    validateRecord(payload, false);
    assertCanAccessRecordScope(actorContext, payload.orgId, payload.scenarioId, payload.createdBy);

    const record = normalizeRecord(payload, false);

    await query(
      `
        INSERT INTO opsscreen_records (
          record_id,
          org_id,
          scenario_id,
          created_by,
          subject_id,
          scenario_name,
          intake_date,
          current_status,
          payload,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
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
        record.createdAt,
        record.updatedAt,
      ]
    );

    await appendAuditEntry({
      action: "create",
      entityType: "record",
      entityId: record.recordId,
      orgId: record.orgId,
      actor: actorContext.user.userId,
      sourceIp: request.headers.get("x-forwarded-for") || "unknown",
      details: { scenarioId: record.scenarioId, subjectId: record.subjectId },
    });

    return json({ record }, { status: 201 });
  } catch (caught) {
    const status = caught instanceof HttpError ? caught.status : 400;
    return error(caught.message || "Failed to create record.", status);
  }
}

function assertCanAccessRecordScope(actorContext, orgId, scenarioId, createdBy) {
  if (actorContext.user.platformRole === "super_admin") {
    return;
  }

  const membership = actorContext.memberships.find((item) => item.orgId === orgId && item.active);
  if (!membership) {
    throw new HttpError("You do not belong to this organization.", 403);
  }

  const scenarioMembership = actorContext.scenarioMemberships.find(
    (item) => item.scenarioId === scenarioId && item.active
  );
  if (!scenarioMembership && membership.orgRole !== "org_admin") {
    throw new HttpError("Join the scenario before submitting records.", 403);
  }

  if (membership.orgRole !== "org_admin" && actorContext.user.userId !== createdBy) {
    throw new HttpError("Users may only submit their own records.", 403);
  }
}
