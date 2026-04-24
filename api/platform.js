import { randomUUID } from "node:crypto";
import {
  appendAuditEntry,
  ensureSchema,
  getPlatformSnapshot,
  getUserContext,
  query,
  randomCode,
} from "../lib/db.js";
import { error, HttpError, json, parseJson } from "../lib/http.js";

export const config = {
  runtime: "nodejs",
};

export async function GET() {
  const snapshot = await getPlatformSnapshot();
  return json(snapshot);
}

export async function POST(request) {
  try {
    await ensureSchema();
    const payload = await parseJson(request);
    const actorContext = await getActorContext(payload.actorUserId);

    switch (payload.action) {
      case "createOrganization":
        assertPlatformAdmin(actorContext);
        return json({
          organization: await createOrganization(payload, actorContext, request),
        });
      case "createUser":
        assertCanManageOrganization(actorContext, payload.orgId);
        return json({
          user: await createUser(payload, actorContext, request),
        });
      case "setOrganizationStatus":
        assertPlatformAdmin(actorContext);
        await setOrganizationStatus(payload, actorContext, request);
        return json({ ok: true });
      case "setOrgAdmin":
        assertPlatformAdmin(actorContext);
        await setOrgAdmin(payload, actorContext, request);
        return json({ ok: true });
      case "assignOrganizationRole":
        assertCanManageOrganization(actorContext, payload.orgId);
        await assignOrganizationRole(payload, actorContext, request);
        return json({ ok: true });
      case "joinOrganization":
        await joinOrganization(payload, actorContext, request);
        return json({ ok: true });
      case "createScenario":
        assertCanManageOrganization(actorContext, payload.orgId);
        return json({
          scenario: await createScenario(payload, actorContext, request),
        });
      case "joinScenario":
        await joinScenario(payload, actorContext, request);
        return json({ ok: true });
      default:
        throw new HttpError("Unsupported platform action.", 400);
    }
  } catch (caught) {
    const status = caught instanceof HttpError ? caught.status : 400;
    return error(caught.message || "Platform action failed.", status);
  }
}

async function createOrganization(payload, actorContext, request) {
  if (!payload.name?.trim()) {
    throw new HttpError("Organization name is required.", 400);
  }

  const organization = {
    orgId: `org-${randomUUID().slice(0, 8)}`,
    name: payload.name.trim(),
    joinCode: randomCode("ORG"),
    active: true,
    createdBy: actorContext.user.userId,
  };

  await query(
    `
      INSERT INTO opsscreen_organizations (org_id, name, join_code, active, created_by)
      VALUES ($1, $2, $3, $4, $5)
    `,
    [
      organization.orgId,
      organization.name,
      organization.joinCode,
      organization.active,
      organization.createdBy,
    ]
  );

  await appendAuditEntry({
    action: "create",
    entityType: "organization",
    entityId: organization.orgId,
    orgId: organization.orgId,
    actor: actorContext.user.userId,
    sourceIp: request.headers.get("x-forwarded-for") || "unknown",
    details: { name: organization.name },
  });

  return organization;
}

async function createUser(payload, actorContext, request) {
  if (!payload.fullName?.trim() || !payload.email?.trim()) {
    throw new HttpError("Full name and email are required.", 400);
  }

  const user = {
    userId: `user-${randomUUID().slice(0, 8)}`,
    fullName: payload.fullName.trim(),
    email: payload.email.trim().toLowerCase(),
    platformRole: "user",
  };

  await query(
    `
      INSERT INTO opsscreen_users (user_id, full_name, email, platform_role)
      VALUES ($1, $2, $3, $4)
    `,
    [user.userId, user.fullName, user.email, user.platformRole]
  );

  if (payload.orgId) {
    const targetRole = normalizeOrgRole(payload.orgRole);
    await upsertOrgMembership(payload.orgId, user.userId, targetRole);
  }

  await appendAuditEntry({
    action: "create",
    entityType: "user",
    entityId: user.userId,
    orgId: payload.orgId || null,
    actor: actorContext.user.userId,
    sourceIp: request.headers.get("x-forwarded-for") || "unknown",
    details: { email: user.email, orgId: payload.orgId || null },
  });

  return user;
}

async function setOrganizationStatus(payload, actorContext, request) {
  if (!payload.orgId || typeof payload.active !== "boolean") {
    throw new HttpError("Organization and active status are required.", 400);
  }

  await query(
    `
      UPDATE opsscreen_organizations
      SET active = $2
      WHERE org_id = $1
    `,
    [payload.orgId, payload.active]
  );

  await appendAuditEntry({
    action: payload.active ? "activate" : "deactivate",
    entityType: "organization",
    entityId: payload.orgId,
    orgId: payload.orgId,
    actor: actorContext.user.userId,
    sourceIp: request.headers.get("x-forwarded-for") || "unknown",
    details: { active: payload.active },
  });
}

async function setOrgAdmin(payload, actorContext, request) {
  if (!payload.orgId || !payload.userId || typeof payload.enabled !== "boolean") {
    throw new HttpError("Organization, user, and enabled flag are required.", 400);
  }

  const membershipRole = payload.enabled ? "org_admin" : "member";
  await upsertOrgMembership(payload.orgId, payload.userId, membershipRole);

  await appendAuditEntry({
    action: payload.enabled ? "assign_admin" : "remove_admin",
    entityType: "organization_membership",
    entityId: `${payload.orgId}:${payload.userId}`,
    orgId: payload.orgId,
    actor: actorContext.user.userId,
    sourceIp: request.headers.get("x-forwarded-for") || "unknown",
    details: { userId: payload.userId, orgRole: membershipRole },
  });
}

async function assignOrganizationRole(payload, actorContext, request) {
  if (!payload.orgId || !payload.userId || !payload.orgRole) {
    throw new HttpError("Organization, user, and role are required.", 400);
  }

  const targetRole = normalizeOrgRole(payload.orgRole);
  await upsertOrgMembership(payload.orgId, payload.userId, targetRole);

  await appendAuditEntry({
    action: "assign_role",
    entityType: "organization_membership",
    entityId: `${payload.orgId}:${payload.userId}`,
    orgId: payload.orgId,
    actor: actorContext.user.userId,
    sourceIp: request.headers.get("x-forwarded-for") || "unknown",
    details: { orgRole: targetRole, userId: payload.userId },
  });
}

async function joinOrganization(payload, actorContext, request) {
  if (!payload.joinCode?.trim()) {
    throw new HttpError("Organization join code is required.", 400);
  }

  const organization = await query(
    `
      SELECT org_id, active
      FROM opsscreen_organizations
      WHERE join_code = $1
    `,
    [payload.joinCode.trim().toUpperCase()]
  );

  if (!organization.rowCount || !organization.rows[0].active) {
    throw new HttpError("Organization join code is invalid or inactive.", 400);
  }

  await upsertOrgMembership(organization.rows[0].org_id, actorContext.user.userId, "member");

  await appendAuditEntry({
    action: "join",
    entityType: "organization_membership",
    entityId: `${organization.rows[0].org_id}:${actorContext.user.userId}`,
    orgId: organization.rows[0].org_id,
    actor: actorContext.user.userId,
    sourceIp: request.headers.get("x-forwarded-for") || "unknown",
    details: { joinCode: payload.joinCode.trim().toUpperCase() },
  });
}

async function createScenario(payload, actorContext, request) {
  if (!payload.orgId || !payload.name?.trim()) {
    throw new HttpError("Organization and scenario name are required.", 400);
  }

  const scenario = {
    scenarioId: `scn-${randomUUID().slice(0, 8)}`,
    orgId: payload.orgId,
    name: payload.name.trim(),
    description: payload.description?.trim() || "",
    joinCode: randomCode("SCN"),
    active: true,
    createdBy: actorContext.user.userId,
  };

  await query(
    `
      INSERT INTO opsscreen_scenarios (
        scenario_id,
        org_id,
        name,
        description,
        join_code,
        active,
        created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      scenario.scenarioId,
      scenario.orgId,
      scenario.name,
      scenario.description,
      scenario.joinCode,
      scenario.active,
      scenario.createdBy,
    ]
  );

  await query(
    `
      INSERT INTO opsscreen_scenario_memberships (scenario_id, user_id, scenario_role)
      VALUES ($1, $2, 'owner')
      ON CONFLICT (scenario_id, user_id)
      DO UPDATE SET scenario_role = EXCLUDED.scenario_role, active = TRUE
    `,
    [scenario.scenarioId, actorContext.user.userId]
  );

  await appendAuditEntry({
    action: "create",
    entityType: "scenario",
    entityId: scenario.scenarioId,
    orgId: scenario.orgId,
    actor: actorContext.user.userId,
    sourceIp: request.headers.get("x-forwarded-for") || "unknown",
    details: { name: scenario.name },
  });

  return scenario;
}

async function joinScenario(payload, actorContext, request) {
  if (!payload.joinCode?.trim()) {
    throw new HttpError("Scenario join code is required.", 400);
  }

  const scenarioResult = await query(
    `
      SELECT scenario_id, org_id, active
      FROM opsscreen_scenarios
      WHERE join_code = $1
    `,
    [payload.joinCode.trim().toUpperCase()]
  );

  if (!scenarioResult.rowCount || !scenarioResult.rows[0].active) {
    throw new HttpError("Scenario join code is invalid or inactive.", 400);
  }

  const scenario = scenarioResult.rows[0];
  const membership = actorContext.memberships.find((item) => item.orgId === scenario.org_id && item.active);
  if (!membership && actorContext.user.platformRole !== "super_admin") {
    throw new HttpError("Join the organization before joining its scenarios.", 403);
  }

  await query(
    `
      INSERT INTO opsscreen_scenario_memberships (scenario_id, user_id, scenario_role)
      VALUES ($1, $2, 'participant')
      ON CONFLICT (scenario_id, user_id)
      DO UPDATE SET active = TRUE
    `,
    [scenario.scenario_id, actorContext.user.userId]
  );

  await appendAuditEntry({
    action: "join",
    entityType: "scenario_membership",
    entityId: `${scenario.scenario_id}:${actorContext.user.userId}`,
    orgId: scenario.org_id,
    actor: actorContext.user.userId,
    sourceIp: request.headers.get("x-forwarded-for") || "unknown",
    details: { joinCode: payload.joinCode.trim().toUpperCase() },
  });
}

async function upsertOrgMembership(orgId, userId, orgRole) {
  await query(
    `
      INSERT INTO opsscreen_org_memberships (org_id, user_id, org_role, active)
      VALUES ($1, $2, $3, TRUE)
      ON CONFLICT (org_id, user_id)
      DO UPDATE SET org_role = EXCLUDED.org_role, active = TRUE
    `,
    [orgId, userId, orgRole]
  );
}

async function getActorContext(actorUserId) {
  if (!actorUserId) {
    throw new HttpError("Actor user is required.", 400);
  }

  const actorContext = await getUserContext(actorUserId);
  if (!actorContext?.user?.active) {
    throw new HttpError("Acting user is invalid or inactive.", 403);
  }
  return actorContext;
}

function assertPlatformAdmin(actorContext) {
  if (actorContext.user.platformRole !== "super_admin") {
    throw new HttpError("Super admin role required.", 403);
  }
}

function assertCanManageOrganization(actorContext, orgId) {
  if (actorContext.user.platformRole === "super_admin") {
    return;
  }

  const membership = actorContext.memberships.find(
    (item) => item.orgId === orgId && item.active && item.orgRole === "org_admin"
  );

  if (!membership) {
    throw new HttpError("Organization admin role required for this organization.", 403);
  }
}

function normalizeOrgRole(value) {
  const allowed = new Set(["org_admin", "member", "instructor", "excon"]);
  const normalized = String(value || "").trim().toLowerCase();
  if (!allowed.has(normalized)) {
    throw new HttpError("Unsupported organization role.", 400);
  }
  return normalized;
}
