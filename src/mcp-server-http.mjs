import { randomUUID } from "node:crypto";
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { registerTools } from "./mcp-tools.mjs";

const PORT = parseInt(process.env.MCP_PORT || "3001", 10);
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

if (!AUTH_TOKEN) {
  console.error("[mcp-http] WARNING: MCP_AUTH_TOKEN not set — server is unprotected!");
}

// Session map: sessionId -> { transport, server }
const sessions = new Map();

function createServer() {
  const server = new McpServer({
    name: "xauusd-screener",
    version: "1.0.0",
  });
  registerTools(server);
  return server;
}

/** Read full request body and parse as JSON. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function checkAuth(req, res, url) {
  if (!AUTH_TOKEN) return true;
  // Accept token from Authorization header or ?token= query parameter
  const header = req.headers["authorization"];
  if (header === `Bearer ${AUTH_TOKEN}`) return true;
  const queryToken = url.searchParams.get("token");
  if (queryToken === AUTH_TOKEN) return true;
  sendJson(res, 401, {
    jsonrpc: "2.0",
    error: { code: -32000, message: "Unauthorized" },
    id: null,
  });
  return false;
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/mcp") {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  if (!checkAuth(req, res, url)) return;

  const method = req.method;

  // ---------- POST ----------
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
      // Existing session
      const { transport } = sessions.get(sessionId);
      await transport.handleRequest(req, res, body);
      return;
    }

    if (!sessionId && isInitializeRequest(body)) {
      // New session
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          console.error(`[mcp-http] Session initialized: ${sid}`);
          sessions.set(sid, { transport, server: mcpServer });
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && sessions.has(sid)) {
          console.error(`[mcp-http] Session closed: ${sid}`);
          sessions.delete(sid);
        }
      };

      const mcpServer = createServer();
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

  // ---------- GET (SSE stream) ----------
  if (method === "GET") {
    const sessionId = req.headers["mcp-session-id"];
    if (!sessionId || !sessions.has(sessionId)) {
      sendJson(res, 400, { error: "Invalid or missing session ID" });
      return;
    }
    const { transport } = sessions.get(sessionId);
    await transport.handleRequest(req, res);
    return;
  }

  // ---------- DELETE (session termination) ----------
  if (method === "DELETE") {
    const sessionId = req.headers["mcp-session-id"];
    if (!sessionId || !sessions.has(sessionId)) {
      sendJson(res, 400, { error: "Invalid or missing session ID" });
      return;
    }
    const { transport } = sessions.get(sessionId);
    await transport.handleRequest(req, res);
    return;
  }

  res.writeHead(405).end("Method Not Allowed");
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.error(`[mcp-http] xauusd-screener MCP HTTP server listening on 0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.error("[mcp-http] Shutting down...");
  for (const [sid, { transport }] of sessions) {
    try {
      await transport.close();
    } catch (e) {
      console.error(`[mcp-http] Error closing session ${sid}:`, e);
    }
  }
  sessions.clear();
  httpServer.close();
  process.exit(0);
});
