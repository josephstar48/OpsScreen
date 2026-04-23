export function json(payload, init = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {}),
    },
  });
}

export function error(message, status = 400) {
  return json({ error: message }, { status });
}

export async function parseJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError("Invalid JSON body.", 400);
  }
}

export class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
