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
let seedPromise;

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
  await schemaPromise;

  if (!seedPromise) {
    seedPromise = seedPlatformData();
  }
  await seedPromise;
}

async function createSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS opsscreen_users (
      user_id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      platform_role TEXT NOT NULL DEFAULT 'user',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    );
  `);

  await query(`
    ALTER TABLE opsscreen_users
      ADD COLUMN IF NOT EXISTS password_hash TEXT,
      ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS opsscreen_organizations (
      org_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      join_code TEXT NOT NULL UNIQUE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS opsscreen_org_memberships (
      org_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      org_role TEXT NOT NULL DEFAULT 'member',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (org_id, user_id)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS opsscreen_scenarios (
      scenario_id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      join_code TEXT NOT NULL UNIQUE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS opsscreen_scenario_memberships (
      scenario_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      scenario_role TEXT NOT NULL DEFAULT 'participant',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (scenario_id, user_id)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS opsscreen_records (
      record_id TEXT PRIMARY KEY,
      org_id TEXT,
      scenario_id TEXT,
      created_by TEXT,
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
    ALTER TABLE opsscreen_records
      ADD COLUMN IF NOT EXISTS org_id TEXT,
      ADD COLUMN IF NOT EXISTS scenario_id TEXT,
      ADD COLUMN IF NOT EXISTS created_by TEXT;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS opsscreen_audit_log (
      id BIGSERIAL PRIMARY KEY,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL DEFAULT 'record',
      entity_id TEXT NOT NULL,
      org_id TEXT,
      actor TEXT NOT NULL,
      source_ip TEXT,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    ALTER TABLE opsscreen_audit_log
      ADD COLUMN IF NOT EXISTS entity_type TEXT NOT NULL DEFAULT 'record',
      ADD COLUMN IF NOT EXISTS entity_id TEXT NOT NULL DEFAULT 'legacy',
      ADD COLUMN IF NOT EXISTS org_id TEXT,
      ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_opsscreen_records_updated_at
      ON opsscreen_records (updated_at DESC);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_opsscreen_records_org_id
      ON opsscreen_records (org_id);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_opsscreen_records_scenario_id
      ON opsscreen_records (scenario_id);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_opsscreen_org_memberships_user
      ON opsscreen_org_memberships (user_id);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_opsscreen_scenarios_org
      ON opsscreen_scenarios (org_id);
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_opsscreen_audit_log_created_at
      ON opsscreen_audit_log (created_at DESC);
  `);
}

async function seedPlatformData() {
  await insertSeedUser("user-super", "OpsScreen Super Admin", "superadmin@opsscreen.training", "super_admin");
  await insertSeedUser("user-admin-508", "CPT Jordan Reeves", "jordan.reeves@opsscreen.training");
  await insertSeedUser("user-admin-abc", "MSG Avery Cole", "avery.cole@opsscreen.training");
  await insertSeedUser("user-trainee-1", "SGT Riley Moore", "riley.moore@opsscreen.training");
  await insertSeedUser("user-trainee-2", "SPC Taylor Nguyen", "taylor.nguyen@opsscreen.training");
  await insertSeedUser("user-excon-1", "SFC Morgan Ellis", "morgan.ellis@opsscreen.training");

  await insertSeedOrganization("org-508", "1-508 PIR", "JOIN-1508", "user-super");
  await insertSeedOrganization("org-abc", "HHBN XVIII ABC", "JOIN-HHBN", "user-super");

  await insertSeedOrgMembership("org-508", "user-admin-508", "org_admin");
  await insertSeedOrgMembership("org-508", "user-trainee-1", "member");
  await insertSeedOrgMembership("org-508", "user-excon-1", "instructor");
  await insertSeedOrgMembership("org-abc", "user-admin-abc", "org_admin");
  await insertSeedOrgMembership("org-abc", "user-trainee-2", "member");

  await insertSeedScenario(
    "scn-epw-lane-1",
    "org-508",
    "EPW Lane 1",
    "Synthetic capture-point reception lane for classroom review.",
    "SCN-EPW1",
    "user-admin-508"
  );
  await insertSeedScenario(
    "scn-mdp-exercise",
    "org-508",
    "MDP Screening Exercise",
    "Synthetic humanitarian intake lane for family reunification and welfare screening.",
    "SCN-MDP1",
    "user-admin-508"
  );
  await insertSeedScenario(
    "scn-rotation-24-01",
    "org-abc",
    "Rotation 24-01",
    "Shared scenario for org-level training records and instructor review.",
    "SCN-2401",
    "user-admin-abc"
  );

  await insertSeedScenarioMembership("scn-epw-lane-1", "user-admin-508", "owner");
  await insertSeedScenarioMembership("scn-epw-lane-1", "user-trainee-1", "participant");
  await insertSeedScenarioMembership("scn-mdp-exercise", "user-admin-508", "owner");
  await insertSeedScenarioMembership("scn-mdp-exercise", "user-excon-1", "controller");
  await insertSeedScenarioMembership("scn-rotation-24-01", "user-admin-abc", "owner");
  await insertSeedScenarioMembership("scn-rotation-24-01", "user-trainee-2", "participant");
}

async function insertSeedUser(userId, fullName, email, platformRole = "user") {
  await query(
    `
      INSERT INTO opsscreen_users (user_id, full_name, email, platform_role)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id) DO NOTHING
    `,
    [userId, fullName, email, platformRole]
  );
}

async function insertSeedOrganization(orgId, name, joinCode, createdBy) {
  await query(
    `
      INSERT INTO opsscreen_organizations (org_id, name, join_code, created_by)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (org_id) DO NOTHING
    `,
    [orgId, name, joinCode, createdBy]
  );
}

async function insertSeedOrgMembership(orgId, userId, orgRole) {
  await query(
    `
      INSERT INTO opsscreen_org_memberships (org_id, user_id, org_role)
      VALUES ($1, $2, $3)
      ON CONFLICT (org_id, user_id) DO NOTHING
    `,
    [orgId, userId, orgRole]
  );
}

async function insertSeedScenario(scenarioId, orgId, name, description, joinCode, createdBy) {
  await query(
    `
      INSERT INTO opsscreen_scenarios (
        scenario_id,
        org_id,
        name,
        description,
        join_code,
        created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (scenario_id) DO NOTHING
    `,
    [scenarioId, orgId, name, description, joinCode, createdBy]
  );
}

async function insertSeedScenarioMembership(scenarioId, userId, scenarioRole) {
  await query(
    `
      INSERT INTO opsscreen_scenario_memberships (scenario_id, user_id, scenario_role)
      VALUES ($1, $2, $3)
      ON CONFLICT (scenario_id, user_id) DO NOTHING
    `,
    [scenarioId, userId, scenarioRole]
  );
}

export async function getPlatformSnapshot() {
  await ensureSchema();

  const [users, organizations, orgMemberships, scenarios, scenarioMemberships] = await Promise.all([
    query(`
      SELECT user_id, full_name, email, platform_role, active, created_at
      FROM opsscreen_users
      ORDER BY platform_role DESC, full_name ASC
    `),
    query(`
      SELECT org_id, name, join_code, active, created_by, created_at
      FROM opsscreen_organizations
      ORDER BY name ASC
    `),
    query(`
      SELECT org_id, user_id, org_role, active, joined_at
      FROM opsscreen_org_memberships
      ORDER BY joined_at ASC
    `),
    query(`
      SELECT scenario_id, org_id, name, description, join_code, active, created_by, created_at
      FROM opsscreen_scenarios
      ORDER BY created_at DESC
    `),
    query(`
      SELECT scenario_id, user_id, scenario_role, active, joined_at
      FROM opsscreen_scenario_memberships
      ORDER BY joined_at ASC
    `),
  ]);

  return {
    users: users.rows.map(mapUser),
    organizations: organizations.rows.map(mapOrganization),
    memberships: orgMemberships.rows.map(mapOrgMembership),
    scenarios: scenarios.rows.map(mapScenario),
    scenarioMemberships: scenarioMemberships.rows.map(mapScenarioMembership),
  };
}

export async function getScopedPlatformSnapshot(actorContext) {
  const snapshot = await getPlatformSnapshot();
  if (actorContext.user.platformRole === "super_admin") {
    return snapshot;
  }

  const activeOrgIds = new Set(
    actorContext.memberships.filter((item) => item.active).map((item) => item.orgId)
  );
  const visibleScenarioIds = new Set(
    actorContext.scenarioMemberships.filter((item) => item.active).map((item) => item.scenarioId)
  );
  const isOrgAdmin = (orgId) =>
    actorContext.memberships.some(
      (item) => item.orgId === orgId && item.active && item.orgRole === "org_admin"
    );

  const organizations = snapshot.organizations
    .filter((org) => activeOrgIds.has(org.orgId))
    .map((org) => ({
      ...org,
      joinCode: isOrgAdmin(org.orgId) ? org.joinCode : "",
    }));
  const scenarios = snapshot.scenarios
    .filter(
      (scenario) =>
        activeOrgIds.has(scenario.orgId) &&
        (isOrgAdmin(scenario.orgId) || visibleScenarioIds.has(scenario.scenarioId))
    )
    .map((scenario) => ({
      ...scenario,
      joinCode: isOrgAdmin(scenario.orgId) ? scenario.joinCode : "",
    }));
  const scenarioIds = new Set(scenarios.map((scenario) => scenario.scenarioId));
  const visibleUserIds = new Set([actorContext.user.userId]);

  snapshot.memberships
    .filter((membership) => activeOrgIds.has(membership.orgId))
    .forEach((membership) => {
      if (isOrgAdmin(membership.orgId)) {
        visibleUserIds.add(membership.userId);
      }
    });

  snapshot.scenarioMemberships
    .filter((membership) => scenarioIds.has(membership.scenarioId))
    .forEach((membership) => {
      visibleUserIds.add(membership.userId);
    });

  return {
    users: snapshot.users.filter((user) => visibleUserIds.has(user.userId)),
    organizations,
    memberships: snapshot.memberships.filter(
      (membership) => activeOrgIds.has(membership.orgId) && visibleUserIds.has(membership.userId)
    ),
    scenarios,
    scenarioMemberships: snapshot.scenarioMemberships.filter(
      (membership) => scenarioIds.has(membership.scenarioId) && visibleUserIds.has(membership.userId)
    ),
  };
}

export async function getUserContext(userId) {
  await ensureSchema();
  const userResult = await query(
    `
      SELECT user_id, full_name, email, platform_role, active, created_at
      FROM opsscreen_users
      WHERE user_id = $1
    `,
    [userId]
  );

  if (!userResult.rowCount) {
    return null;
  }

  const [membershipResult, scenarioMembershipResult] = await Promise.all([
    query(
      `
        SELECT org_id, user_id, org_role, active, joined_at
        FROM opsscreen_org_memberships
        WHERE user_id = $1
      `,
      [userId]
    ),
    query(
      `
        SELECT scenario_id, user_id, scenario_role, active, joined_at
        FROM opsscreen_scenario_memberships
        WHERE user_id = $1
      `,
      [userId]
    ),
  ]);

  return {
    user: mapUser(userResult.rows[0]),
    memberships: membershipResult.rows.map(mapOrgMembership),
    scenarioMemberships: scenarioMembershipResult.rows.map(mapScenarioMembership),
  };
}

export async function appendAuditEntry({
  action,
  entityType,
  entityId,
  orgId = null,
  actor,
  sourceIp = "unknown",
  details = {},
}) {
  await ensureSchema();
  await query(
    `
      INSERT INTO opsscreen_audit_log (
        action,
        entity_type,
        entity_id,
        org_id,
        actor,
        source_ip,
        details
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    `,
    [action, entityType, entityId, orgId, actor, sourceIp, JSON.stringify(details)]
  );
}

export function randomCode(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function mapUser(row) {
  return {
    userId: row.user_id,
    fullName: row.full_name,
    email: row.email,
    platformRole: row.platform_role,
    active: row.active,
    createdAt: row.created_at,
  };
}

function mapOrganization(row) {
  return {
    orgId: row.org_id,
    name: row.name,
    joinCode: row.join_code,
    active: row.active,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function mapOrgMembership(row) {
  return {
    orgId: row.org_id,
    userId: row.user_id,
    orgRole: row.org_role,
    active: row.active,
    joinedAt: row.joined_at,
  };
}

function mapScenario(row) {
  return {
    scenarioId: row.scenario_id,
    orgId: row.org_id,
    name: row.name,
    description: row.description,
    joinCode: row.join_code,
    active: row.active,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function mapScenarioMembership(row) {
  return {
    scenarioId: row.scenario_id,
    userId: row.user_id,
    scenarioRole: row.scenario_role,
    active: row.active,
    joinedAt: row.joined_at,
  };
}
