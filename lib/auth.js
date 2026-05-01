import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import { getUserContext, query } from "./db.js";
import { HttpError } from "./http.js";

const SESSION_COOKIE = "opsscreen_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new HttpError("AUTH_SECRET must be set to at least 32 characters.", 500);
  }
  return secret;
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(password, salt, 64).toString("base64url");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, storedHash) {
  const [scheme, salt, hash] = String(storedHash || "").split(":");
  if (scheme !== "scrypt" || !salt || !hash) {
    return false;
  }

  const expected = Buffer.from(hash, "base64url");
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createSessionCookie(userId) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    userId,
    issuedAt,
    expiresAt: issuedAt + SESSION_MAX_AGE_SECONDS,
    nonce: randomUUID(),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(encodedPayload);
  return [
    `${SESSION_COOKIE}=${encodedPayload}.${signature}`,
    "HttpOnly",
    "Path=/",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}

export async function requireAuth(request) {
  const userId = readSignedSession(request);
  if (!userId) {
    throw new HttpError("Authentication required.", 401);
  }

  const actorContext = await getUserContext(userId);
  if (!actorContext?.user?.active) {
    throw new HttpError("Authenticated user is invalid or inactive.", 403);
  }
  return actorContext;
}

export async function findUserForSignIn(email) {
  const result = await query(
    `
      SELECT user_id, email, password_hash, platform_role, active
      FROM opsscreen_users
      WHERE lower(email) = lower($1)
    `,
    [email]
  );
  return result.rows[0] || null;
}

export async function createAccount({ fullName, email, password }) {
  const existing = await findUserForSignIn(email);
  if (existing?.password_hash) {
    throw new HttpError("An account already exists for that email.", 409);
  }

  const credentialCount = await query(
    "SELECT COUNT(*)::int AS count FROM opsscreen_users WHERE password_hash IS NOT NULL"
  );
  const platformRole = credentialCount.rows[0].count === 0 ? "super_admin" : "user";

  if (existing) {
    await query(
      `
        UPDATE opsscreen_users
        SET full_name = $2, password_hash = $3, platform_role = $4
        WHERE user_id = $1
      `,
      [
        existing.user_id,
        fullName.trim(),
        hashPassword(password),
        existing.platform_role === "super_admin" ? "super_admin" : platformRole,
      ]
    );
    return getUserContext(existing.user_id);
  }

  const userId = `user-${randomUUID().slice(0, 8)}`;

  await query(
    `
      INSERT INTO opsscreen_users (user_id, full_name, email, platform_role, password_hash)
      VALUES ($1, $2, $3, $4, $5)
    `,
    [userId, fullName.trim(), email.trim().toLowerCase(), platformRole, hashPassword(password)]
  );

  return getUserContext(userId);
}

function readSignedSession(request) {
  const cookieHeader = request.headers.get("cookie") || "";
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) {
    return null;
  }

  const token = cookie.slice(SESSION_COOKIE.length + 1);
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature || sign(encodedPayload) !== signature) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (!payload.userId || payload.expiresAt < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload.userId;
  } catch {
    return null;
  }
}

function sign(value) {
  return createHmac("sha256", getAuthSecret()).update(value).digest("base64url");
}
