import { ensureSchema, query } from "../lib/db.js";
import { json } from "../lib/http.js";

export const config = {
  runtime: "nodejs",
};

export async function GET() {
  await ensureSchema();
  const result = await query("SELECT NOW() AS now");

  return json({
    ok: true,
    mode: "api",
    detail:
      "Connected to Vercel Functions with managed Postgres storage. Records persist outside the deployment filesystem.",
    database: {
      provider: "Marketplace Postgres",
      connectedAt: result.rows[0].now,
    },
  });
}
