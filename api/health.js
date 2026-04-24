import { ensureSchema, query } from "../lib/db.js";
import { json } from "../lib/http.js";

export const config = {
  runtime: "nodejs",
};

export async function GET() {
  await ensureSchema();
  const [databaseNow, organizationCount, userCount, scenarioCount] = await Promise.all([
    query("SELECT NOW() AS now"),
    query("SELECT COUNT(*)::int AS count FROM opsscreen_organizations"),
    query("SELECT COUNT(*)::int AS count FROM opsscreen_users"),
    query("SELECT COUNT(*)::int AS count FROM opsscreen_scenarios"),
  ]);

  return json({
    ok: true,
    mode: "api",
    detail:
      "Connected to the multi-organization training backend with managed Postgres storage.",
    database: {
      connectedAt: databaseNow.rows[0].now,
      organizations: organizationCount.rows[0].count,
      users: userCount.rows[0].count,
      scenarios: scenarioCount.rows[0].count,
    },
  });
}
