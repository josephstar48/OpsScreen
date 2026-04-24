import { ensureSchema, getUserContext, query } from "../lib/db.js";
import { error, HttpError, json } from "../lib/http.js";

export const config = {
  runtime: "nodejs",
};

export async function GET(request) {
  try {
    await ensureSchema();
    const url = new URL(request.url);
    const actorUserId = url.searchParams.get("actorUserId");
    const orgId = url.searchParams.get("orgId");
    const actorContext = await getActor(actorUserId);

    let sql = `
      SELECT id, action, entity_type, entity_id, org_id, actor, source_ip, details, created_at
      FROM opsscreen_audit_log
      WHERE 1 = 1
    `;
    const params = [];

    if (orgId) {
      params.push(orgId);
      sql += ` AND org_id = $${params.length}`;
    }

    if (actorContext.user.platformRole !== "super_admin") {
      const adminOrgIds = actorContext.memberships
        .filter((item) => item.active && item.orgRole === "org_admin")
        .map((item) => item.orgId);

      if (!adminOrgIds.length) {
        return json({ entries: [] });
      }

      params.push(adminOrgIds);
      sql += ` AND org_id = ANY($${params.length}::text[])`;
    }

    sql += ` ORDER BY created_at DESC LIMIT 100`;
    const result = await query(sql, params);

    return json({
      entries: result.rows.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        orgId: row.org_id,
        actor: row.actor,
        sourceIp: row.source_ip,
        details: row.details,
        createdAt: row.created_at,
      })),
    });
  } catch (caught) {
    const status = caught instanceof HttpError ? caught.status : 400;
    return error(caught.message || "Failed to load audit log.", status);
  }
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
