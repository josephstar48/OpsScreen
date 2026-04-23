const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { randomUUID } = require("crypto");

const rootDir = __dirname;
const dataDir = path.join(rootDir, "data");
const databasePath = path.join(dataDir, "opsscreen-db.json");
const auditLogPath = path.join(dataDir, "audit-log.json");
const port = Number(process.env.PORT || 4173);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

ensureDataFiles();

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname.startsWith("/api/")) {
    await handleApi(request, response, url);
    return;
  }

  serveStatic(request, response, url);
});

server.listen(port, () => {
  console.log(`OpsScreen running on http://localhost:${port}`);
});

function ensureDataFiles() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(databasePath)) {
    const seed = {
      metadata: {
        app: "OpsScreen",
        mode: "training-only",
        classification: "synthetic-data-only",
        createdAt: new Date().toISOString(),
      },
      records: [],
    };
    fs.writeFileSync(databasePath, JSON.stringify(seed, null, 2));
  }

  if (!fs.existsSync(auditLogPath)) {
    fs.writeFileSync(auditLogPath, JSON.stringify({ entries: [] }, null, 2));
  }
}

async function handleApi(request, response, url) {
  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, {
        ok: true,
        mode: "api",
        detail:
          "Connected to local Node API with file-backed training database and audit log.",
      });
    }

    if (request.method === "GET" && url.pathname === "/api/records") {
      const database = readDatabase();
      return sendJson(response, 200, {
        records: sortRecords(database.records),
        total: database.records.length,
      });
    }

    if (request.method === "GET" && url.pathname === "/api/audit-log") {
      const auditLog = readAuditLog();
      return sendJson(response, 200, {
        entries: auditLog.entries.slice(-100).reverse(),
      });
    }

    if (request.method === "POST" && url.pathname === "/api/records") {
      const payload = await readJsonBody(request);
      validateRecord(payload, false);
      const database = readDatabase();
      const record = normalizeRecord(payload, false);
      database.records.unshift(record);
      writeDatabase(database);
      appendAuditEntry("create", record.recordId, request);
      return sendJson(response, 201, { record });
    }

    if (request.method === "PUT" && url.pathname.startsWith("/api/records/")) {
      const recordId = decodeURIComponent(url.pathname.split("/").pop());
      const payload = await readJsonBody(request);
      validateRecord(payload, true);
      const database = readDatabase();
      const index = database.records.findIndex((item) => item.recordId === recordId);

      if (index === -1) {
        return sendJson(response, 404, { error: "Record not found." });
      }

      const record = normalizeRecord({ ...payload, recordId }, true);
      database.records[index] = record;
      writeDatabase(database);
      appendAuditEntry("update", record.recordId, request);
      return sendJson(response, 200, { record });
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/api/records/")) {
      const recordId = decodeURIComponent(url.pathname.split("/").pop());
      const database = readDatabase();
      const nextRecords = database.records.filter((item) => item.recordId !== recordId);

      if (nextRecords.length === database.records.length) {
        return sendJson(response, 404, { error: "Record not found." });
      }

      database.records = nextRecords;
      writeDatabase(database);
      appendAuditEntry("delete", recordId, request);
      return sendJson(response, 200, { ok: true });
    }

    sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    sendJson(response, error.statusCode || 500, {
      error: error.message || "Unexpected server error.",
    });
  }
}

function serveStatic(request, response, url) {
  const rawPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = path.normalize(rawPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(rootDir, safePath);

  if (!filePath.startsWith(rootDir)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, file) => {
    if (error) {
      if (safePath === "/favicon.ico") {
        fs.readFile(path.join(rootDir, "assets/icons/favicon.png"), (iconError, icon) => {
          if (iconError) {
            sendText(response, 404, "Not found");
            return;
          }
          response.writeHead(200, {
            "Content-Type": "image/png",
            "Cache-Control": "no-cache",
          });
          response.end(icon);
        });
        return;
      }

      sendText(response, 404, "Not found");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
      "Cache-Control": extension === ".html" ? "no-cache" : "public, max-age=300",
    });
    response.end(file);
  });
}

function readDatabase() {
  return JSON.parse(fs.readFileSync(databasePath, "utf8"));
}

function writeDatabase(database) {
  database.metadata.updatedAt = new Date().toISOString();
  fs.writeFileSync(databasePath, JSON.stringify(database, null, 2));
}

function readAuditLog() {
  return JSON.parse(fs.readFileSync(auditLogPath, "utf8"));
}

function appendAuditEntry(action, recordId, request) {
  const auditLog = readAuditLog();
  auditLog.entries.push({
    id: randomUUID(),
    action,
    recordId,
    timestamp: new Date().toISOString(),
    actor: request.headers["x-opsscreen-user"] || "local-training-user",
    sourceIp: request.socket.remoteAddress || "unknown",
  });
  fs.writeFileSync(auditLogPath, JSON.stringify(auditLog, null, 2));
}

function normalizeRecord(payload, isUpdate) {
  const now = new Date().toISOString();
  return {
    recordId: payload.recordId || randomUUID(),
    scenarioName: sanitize(payload.scenarioName),
    exerciseName: sanitize(payload.exerciseName),
    intakeSite: sanitize(payload.intakeSite),
    intakeDate: sanitize(payload.intakeDate),
    screenedBy: sanitize(payload.screenedBy),
    languageSupport: sanitize(payload.languageSupport),
    subjectId: sanitize(payload.subjectId),
    firstName: sanitize(payload.firstName),
    lastName: sanitize(payload.lastName),
    alias: sanitize(payload.alias),
    dob: sanitize(payload.dob),
    nationality: sanitize(payload.nationality),
    groupMembers: sanitize(payload.groupMembers),
    immediateNeeds: sanitize(payload.immediateNeeds),
    medicalLevel: sanitize(payload.medicalLevel),
    safeguardingConcern: sanitize(payload.safeguardingConcern),
    currentStatus: sanitize(payload.currentStatus),
    propertyNotes: sanitize(payload.propertyNotes),
    welfareNotes: sanitize(payload.welfareNotes),
    originLocation: sanitize(payload.originLocation),
    transitPoint: sanitize(payload.transitPoint),
    destination: sanitize(payload.destination),
    arrivalMethod: sanitize(payload.arrivalMethod),
    consentScript: sanitize(payload.consentScript),
    additionalNotes: sanitize(payload.additionalNotes),
    referralDestination: sanitize(payload.referralDestination),
    followUpOwner: sanitize(payload.followUpOwner),
    followUpDate: sanitize(payload.followUpDate),
    classification: sanitize(payload.classification) || "Training use only",
    syntheticConfirmed: Boolean(payload.syntheticConfirmed),
    storageMode: "api",
    createdAt: isUpdate ? sanitize(payload.createdAt) || now : now,
    updatedAt: now,
  };
}

function validateRecord(payload, isUpdate) {
  if (!payload || typeof payload !== "object") {
    throw createHttpError(400, "Request body must be a JSON object.");
  }

  if (!payload.syntheticConfirmed) {
    throw createHttpError(400, "Synthetic-data confirmation is required.");
  }

  if (!sanitize(payload.scenarioName)) {
    throw createHttpError(400, "Scenario name is required.");
  }

  if (!sanitize(payload.subjectId)) {
    throw createHttpError(400, "Mock subject ID is required.");
  }

  if (!sanitize(payload.intakeDate)) {
    throw createHttpError(400, "Intake date is required.");
  }

  if (isUpdate && !sanitize(payload.recordId)) {
    throw createHttpError(400, "Record ID is required for updates.");
  }
}

function sortRecords(records) {
  return [...records].sort((left, right) => {
    return new Date(right.updatedAt || 0) - new Date(left.updatedAt || 0);
  });
}

function sanitize(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(createHttpError(413, "Payload too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(createHttpError(400, "Invalid JSON body."));
      }
    });
    request.on("error", () => reject(createHttpError(400, "Failed to read request body.")));
  });
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  response.end(body);
}

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  response.end(body);
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
