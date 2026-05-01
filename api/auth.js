import {
  clearSessionCookie,
  createAccount,
  createSessionCookie,
  findUserForSignIn,
  requireAuth,
  verifyPassword,
} from "../lib/auth.js";
import { appendAuditEntry, ensureSchema, getUserContext, query } from "../lib/db.js";
import { error, HttpError, json, parseJson } from "../lib/http.js";

export const config = {
  runtime: "nodejs",
};

export async function GET(request) {
  try {
    await ensureSchema();
    const actorContext = await requireAuth(request);
    return json({ authenticated: true, user: actorContext.user });
  } catch (caught) {
    if (caught instanceof HttpError && caught.status === 401) {
      return json({ authenticated: false, user: null });
    }
    const status = caught instanceof HttpError ? caught.status : 400;
    return error(caught.message || "Failed to load auth session.", status);
  }
}

export async function POST(request) {
  try {
    await ensureSchema();
    const payload = await parseJson(request);

    if (payload.action === "signOut") {
      return json(
        { ok: true },
        {
          headers: {
            "set-cookie": clearSessionCookie(),
          },
        }
      );
    }

    if (payload.action === "signUp") {
      validateSignUp(payload);
      const actorContext = await createAccount(payload);
      await appendAuditEntry({
        action: "signup",
        entityType: "user",
        entityId: actorContext.user.userId,
        actor: actorContext.user.userId,
        sourceIp: request.headers.get("x-forwarded-for") || "unknown",
        details: { email: actorContext.user.email },
      });
      return sessionResponse(actorContext);
    }

    if (payload.action === "signIn") {
      validateSignIn(payload);
      const user = await findUserForSignIn(payload.email);
      if (!user?.active || !verifyPassword(payload.password, user.password_hash)) {
        throw new HttpError("Invalid email or password.", 401);
      }

      await query("UPDATE opsscreen_users SET last_login_at = NOW() WHERE user_id = $1", [
        user.user_id,
      ]);
      return sessionResponse(await getUserContext(user.user_id));
    }

    throw new HttpError("Unsupported auth action.", 400);
  } catch (caught) {
    const status = caught instanceof HttpError ? caught.status : 400;
    return error(caught.message || "Authentication failed.", status);
  }
}

function sessionResponse(actorContext) {
  return json(
    { authenticated: true, user: actorContext.user },
    {
      headers: {
        "set-cookie": createSessionCookie(actorContext.user.userId),
      },
    }
  );
}

function validateSignUp(payload) {
  if (!payload.fullName?.trim()) {
    throw new HttpError("Full name is required.", 400);
  }
  validateSignIn(payload);
}

function validateSignIn(payload) {
  if (!payload.email?.trim() || !payload.password) {
    throw new HttpError("Email and password are required.", 400);
  }
  if (String(payload.password).length < 10) {
    throw new HttpError("Password must be at least 10 characters.", 400);
  }
}
