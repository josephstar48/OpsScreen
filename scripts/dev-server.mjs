import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 3000);

await loadEnvFile(path.join(root, ".env.local"));

const apiRoutes = [
  { pattern: /^\/api\/auth$/, file: "api/auth.js" },
  { pattern: /^\/api\/platform$/, file: "api/platform.js" },
  { pattern: /^\/api\/health$/, file: "api/health.js" },
  { pattern: /^\/api\/audit-log$/, file: "api/audit-log.js" },
  { pattern: /^\/api\/records$/, file: "api/records/index.js" },
  { pattern: /^\/api\/records\/[^/]+$/, file: "api/records/[recordId].js" },
];

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || `localhost:${port}`}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    await handleStatic(response, url.pathname);
  } catch (error) {
    console.error(error);
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("Local dev server error");
  }
}).listen(port, () => {
  console.log(`OpsScreen local dev server ready at http://localhost:${port}`);
});

async function handleApi(nodeRequest, nodeResponse, url) {
  const route = apiRoutes.find((item) => item.pattern.test(url.pathname));
  if (!route) {
    nodeResponse.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    nodeResponse.end(JSON.stringify({ error: "API route not found." }));
    return;
  }

  const moduleUrl = pathToFileURL(path.join(root, route.file)).href;
  const apiModule = await import(`${moduleUrl}?t=${Date.now()}`);
  const handler = apiModule[nodeRequest.method || "GET"];
  if (!handler) {
    nodeResponse.writeHead(405, { "content-type": "application/json; charset=utf-8" });
    nodeResponse.end(JSON.stringify({ error: "Method not allowed." }));
    return;
  }

  const body = ["GET", "HEAD"].includes(nodeRequest.method || "GET")
    ? undefined
    : await readRequestBody(nodeRequest);
  const request = new Request(url.toString(), {
    method: nodeRequest.method,
    headers: nodeRequest.headers,
    body,
  });
  const apiResponse = await handler(request);

  nodeResponse.statusCode = apiResponse.status;
  apiResponse.headers.forEach((value, key) => {
    nodeResponse.setHeader(key, value);
  });
  nodeResponse.end(Buffer.from(await apiResponse.arrayBuffer()));
}

async function handleStatic(response, pathname) {
  const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const filePath = path.resolve(root, relativePath);
  if (!filePath.startsWith(root) || !existsSync(filePath)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": contentType(filePath),
    "cache-control": "no-store",
  });
  createReadStream(filePath).pipe(response);
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }
  const contents = await readFile(filePath, "utf8");
  contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .forEach((line) => {
      const index = line.indexOf("=");
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) {
        process.env[key] = value;
      }
    });
}

function contentType(filePath) {
  return {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".webmanifest": "application/manifest+json; charset=utf-8",
  }[path.extname(filePath)] || "application/octet-stream";
}
