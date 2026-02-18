import "dotenv/config";
import { randomUUID } from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { registerTools } from "./mcp-tools.mjs";

const require = createRequire(import.meta.url);
const capture = require("./capture.js");
const config = require("./config.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.MCP_PORT || "3001", 10);
const SESSION_TTL_MS = parseInt(process.env.MCP_SESSION_TTL || "600000", 10);
const BASE_URL = (process.env.REST_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

const SCREENSHOTS_DIR = path.resolve(__dirname, "..", "screenshots");
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const SCREENSHOTS_TTL_MS = parseInt(process.env.SCREENSHOTS_TTL || "1800000", 10); // 30 min default

// ── Screenshot cleanup ───────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  try {
    for (const file of fs.readdirSync(SCREENSHOTS_DIR)) {
      if (!file.endsWith(".png") && !file.endsWith(".jpg") && !file.endsWith(".jpeg")) continue;
      const filePath = path.join(SCREENSHOTS_DIR, file);
      const { mtimeMs } = fs.statSync(filePath);
      if (now - mtimeMs > SCREENSHOTS_TTL_MS) {
        fs.unlinkSync(filePath);
        cleaned++;
      }
    }
  } catch (e) {
    console.error(`[cleanup] Error: ${e.message}`);
  }
  if (cleaned > 0) console.error(`[cleanup] Removed ${cleaned} expired screenshot(s)`);
}, 60_000);


// ── MCP session management ─────────────────────────────────────────

const sessions = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [sid, session] of sessions) {
    if (now - session.lastActivity > SESSION_TTL_MS) {
      console.error(`[mcp-http] Reaping idle session: ${sid} (inactive ${Math.round((now - session.lastActivity) / 1000)}s)`);
      try { session.transport.close(); } catch {}
      sessions.delete(sid);
    }
  }
}, 60_000);

function createMcpServer() {
  const server = new McpServer({ name: "xauusd-screener", version: "1.0.0" });
  registerTools(server);
  return server;
}

// ── helpers ─────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString();
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

// ── OpenAPI schema (for ChatGPT Actions) ────────────────────────────

const OPENAPI_SCHEMA = {
  openapi: "3.1.0",
  info: {
    title: "XAUUSD Chart Screener",
    description: "Cattura screenshot multi-timeframe del grafico XAUUSD da TradingView con indicatori SMA/EMA",
    version: "1.0.0",
  },
  servers: [{ url: BASE_URL }],
  paths: {
    "/capture-charts": {
      post: {
        operationId: "captureCharts",
        "x-openai-isConsequential": false,
        summary: "Cattura screenshot dei grafici XAUUSD su uno o più timeframe",
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  timeframes: {
                    type: "array",
                    items: {
                      type: "string",
                      enum: config.timeframes.map((t) => t.filename),
                    },
                    description: "Timeframe da catturare (es. 5M, 15M, 30M, 1H, 4H). Ometti per catturare tutti.",
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Screenshot catturati con successo",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    symbol: { type: "string" },
                    studies: { type: "array", items: { type: "string" } },
                    charts: {
                      type: "array",
                      description: "Array di grafici catturati con URL immagine JPEG.",
                      items: {
                        type: "object",
                        properties: {
                          timeframe: { type: "string", description: "Codice timeframe (es. 1H, 4H)" },
                          label: { type: "string", description: "Etichetta leggibile (es. 1 Ora)" },
                          image_url: { type: "string", format: "uri", description: "URL pubblico dell'immagine JPEG. IMPORTANTE: mostra SEMPRE ogni immagine inline usando markdown ![label](image_url)" },
                        },
                      },
                    },
                    _instruction: { type: "string", description: "Istruzione per l'assistente su come visualizzare i risultati" },
                  },
                },
              },
            },
          },
          500: {
            description: "Errore durante la cattura",
            content: {
              "application/json": {
                schema: { type: "object", properties: { error: { type: "string" } } },
              },
            },
          },
        },
      },
    },
    "/config": {
      get: {
        operationId: "getConfig",
        "x-openai-isConsequential": false,
        summary: "Restituisce la configurazione corrente (simbolo, timeframe, studi)",
        responses: {
          200: {
            description: "Configurazione corrente",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    symbol: { type: "string" },
                    timeframes: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          value: { type: "string" },
                          label: { type: "string" },
                          filename: { type: "string" },
                        },
                      },
                    },
                    studies: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          plotName: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

// ── HTTP server ─────────────────────────────────────────────────────

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const method = req.method;

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, mcp-session-id",
    });
    res.end();
    return;
  }

  // ── GET /openapi.json — no auth needed ────────────────────────────
  if (pathname === "/openapi.json" && method === "GET") {
    sendJson(res, 200, OPENAPI_SCHEMA);
    return;
  }

  // ── GET /screenshots/... — serve images, no auth ─────────────────
  if (pathname.startsWith("/screenshots/") && method === "GET") {
    // Support /screenshots/cache/file.png and /screenshots/file.png
    const relative = pathname.replace("/screenshots/", "");
    const filePath = path.join(SCREENSHOTS_DIR, ...relative.split("/").map((s) => path.basename(s)));
    if (!fs.existsSync(filePath)) {
      sendJson(res, 404, { error: "Image not found" });
      return;
    }
    const data = fs.readFileSync(filePath);
    const contentType = filePath.endsWith(".jpg") || filePath.endsWith(".jpeg") ? "image/jpeg" : "image/png";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": data.length,
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(data);
    return;
  }

  // ══════════════════════════════════════════════════════════════════
  // ── SSE transport (no auth) ─────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  if (pathname === "/sse" && method === "GET") {
    console.error("[mcp-sse] New SSE connection");
    const transport = new SSEServerTransport("/messages", res);
    const mcpServer = createMcpServer();

    sessions.set(transport.sessionId, {
      transport,
      server: mcpServer,
      lastActivity: Date.now(),
      type: "sse",
    });

    res.on("close", () => {
      console.error(`[mcp-sse] SSE connection closed: ${transport.sessionId}`);
      sessions.delete(transport.sessionId);
    });

    await mcpServer.connect(transport);
    await transport.start();
    return;
  }

  if (pathname === "/messages" && method === "POST") {
    const sessionId = url.searchParams.get("sessionId");
    const session = sessionId && sessions.get(sessionId);

    if (!session || !(session.transport instanceof SSEServerTransport)) {
      sendJson(res, 400, { error: "Invalid or missing SSE session ID" });
      return;
    }

    session.lastActivity = Date.now();
    let body;
    try { body = await readBody(req); } catch { body = undefined; }
    await session.transport.handlePostMessage(req, res, body);
    return;
  }

  // ── GET /config — REST endpoint ───────────────────────────────────
  if (pathname === "/config" && method === "GET") {
    sendJson(res, 200, config);
    return;
  }

  // ── POST /capture-charts — REST endpoint ──────────────────────────
  if (pathname === "/capture-charts" && method === "POST") {
    let body;
    try { body = await readBody(req); } catch { body = {}; }

    const { timeframes } = body;
    console.error(`[rest] capture-charts called, timeframes=${timeframes || "all"}`);

    try {
      // JPEG + smaller viewport to keep image URLs lightweight for ChatGPT
      const results = await capture({
        timeframes,
        viewport: { width: 1280, height: 800 },
        returnBuffers: true,
        screenshotOptions: { type: "jpeg", quality: 75 },
      });

      const charts = [];
      for (const r of results) {
        const fname = `${config.symbol}_${r.timeframe}_${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`;
        const filePath = path.join(SCREENSHOTS_DIR, fname);
        fs.writeFileSync(filePath, r.buffer);

        charts.push({
          timeframe: r.timeframe,
          label: r.label,
          image_url: `${BASE_URL}/screenshots/${fname}`,
        });
        console.error(`[rest] ${r.label}: ${Math.round(r.buffer.length / 1024)}KB`);
      }

      sendJson(res, 200, {
        symbol: config.symbol,
        studies: config.studies.map((s) => `${s.id} (length=${s.inputs.length})`),
        charts,
        _instruction: "IMPORTANTE: mostra OGNI immagine inline con markdown ![XAUUSD LABEL](image_url) e poi analizza il grafico. Non mostrare solo i link.",
      });
    } catch (err) {
      console.error(`[rest] capture error: ${err.message}`);
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // ══════════════════════════════════════════════════════════════════
  // ── MCP Streamable HTTP on /mcp ─────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  if (pathname !== "/mcp") {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  // ---------- POST /mcp ----------
  if (method === "POST") {
    let body;
    try {
      body = await readBody(req);
    } catch {
      sendJson(res, 400, {
        jsonrpc: "2.0",
        error: { code: -32700, message: "Parse error" },
        id: null,
      });
      return;
    }

    const sessionId = req.headers["mcp-session-id"];

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId);
      session.lastActivity = Date.now();
      await session.transport.handleRequest(req, res, body);
      return;
    }

    if (sessionId && !sessions.has(sessionId) && !isInitializeRequest(body)) {
      console.error(`[mcp-http] Rejected stale session: ${sessionId}`);
      sendJson(res, 404, {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Session not found" },
        id: null,
      });
      return;
    }

    if (isInitializeRequest(body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          console.error(`[mcp-http] Session initialized: ${sid}`);
          sessions.set(sid, { transport, server: mcpServer, lastActivity: Date.now() });
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && sessions.has(sid)) {
          console.error(`[mcp-http] Session closed: ${sid}`);
          sessions.delete(sid);
        }
      };

      const mcpServer = createMcpServer();
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    sendJson(res, 400, {
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: no valid session ID" },
      id: null,
    });
    return;
  }

  // ---------- GET /mcp (SSE stream) ----------
  if (method === "GET") {
    const sessionId = req.headers["mcp-session-id"];
    if (!sessionId || !sessions.has(sessionId)) {
      sendJson(res, 400, { error: "Invalid or missing session ID" });
      return;
    }
    const session = sessions.get(sessionId);
    session.lastActivity = Date.now();
    await session.transport.handleRequest(req, res);
    return;
  }

  // ---------- DELETE /mcp (session termination) ----------
  if (method === "DELETE") {
    const sessionId = req.headers["mcp-session-id"];
    if (!sessionId || !sessions.has(sessionId)) {
      sendJson(res, 400, { error: "Invalid or missing session ID" });
      return;
    }
    const session = sessions.get(sessionId);
    await session.transport.handleRequest(req, res);
    return;
  }

  res.writeHead(405).end("Method Not Allowed");
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.error(`[mcp-http] xauusd-screener listening on 0.0.0.0:${PORT}`);
  console.error(`[mcp-http] MCP Streamable HTTP: /mcp`);
  console.error(`[mcp-http] MCP SSE (legacy):    /sse + /messages`);
  console.error(`[mcp-http] REST endpoints:       /capture-charts, /config`);
  console.error(`[mcp-http] OpenAPI schema:       ${BASE_URL}/openapi.json`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.error("[mcp-http] Shutting down...");
  for (const [sid, { transport }] of sessions) {
    try { await transport.close(); } catch (e) {
      console.error(`[mcp-http] Error closing session ${sid}:`, e);
    }
  }
  sessions.clear();
  httpServer.close();
  process.exit(0);
});
