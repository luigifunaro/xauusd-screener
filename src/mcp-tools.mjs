import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const capture = require("./capture.js");
const config = require("./config.js");

const MCP_VIEWPORT = { width: 1280, height: 800 };

/**
 * Register all xauusd-screener tools on the given McpServer instance.
 * @param {object} server - McpServer instance
 * @param {object} [opts] - Options
 * @param {string} [opts.baseUrl] - Public base URL for image links
 * @param {string} [opts.screenshotsDir] - Directory to save screenshots
 */
export function registerTools(server, opts = {}) {
  const baseUrl = opts.baseUrl;
  const screenshotsDir = opts.screenshotsDir;

  server.tool(
    "capture_charts",
    "Capture XAUUSD multi-timeframe chart screenshots from TradingView with SMA/EMA indicators. Returns image URLs that MUST be displayed inline using markdown: ![XAUUSD label](image_url)",
    {
      timeframes: z
        .array(z.string())
        .optional()
        .describe(
          `Timeframes to capture. Available: ${config.timeframes.map((t) => t.filename).join(", ")}. Omit for all.`
        ),
    },
    async ({ timeframes }) => {
      console.error(`[mcp] capture_charts called, timeframes=${timeframes || "all"}`);

      try {
        const useUrls = baseUrl && screenshotsDir;
        const results = await capture({
          timeframes,
          viewport: MCP_VIEWPORT,
          returnBuffers: true,
          ...(useUrls && { screenshotOptions: { type: "jpeg", quality: 75 } }),
        });

        if (results.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No charts captured. Check that the requested timeframes are valid. Available: " +
                  config.timeframes.map((t) => t.filename).join(", "),
              },
            ],
          };
        }

        const content = [];

        content.push({
          type: "text",
          text: `Captured ${results.length} XAUUSD chart(s): ${results.map((r) => r.label).join(", ")}\nStudies: ${config.studies.map((s) => `${s.id} (length=${s.inputs.length})`).join(", ")}`,
        });

        if (useUrls) {
          // Save to disk and return public URLs (for ChatGPT, Gemini, Grok, etc.)
          const charts = [];
          for (const r of results) {
            const ext = r.buffer[0] === 0xff ? "jpg" : "png";
            const fname = `${config.symbol}_${r.timeframe}_${Date.now()}.${ext}`;
            const filePath = path.join(screenshotsDir, fname);
            fs.writeFileSync(filePath, r.buffer);
            const imageUrl = `${baseUrl}/screenshots/${fname}`;
            charts.push({ timeframe: r.timeframe, label: r.label, imageUrl });
            console.error(`[mcp] ${r.label}: ${Math.round(r.buffer.length / 1024)}KB → ${fname}`);
          }

          content.push({
            type: "text",
            text: charts
              .map((c) => `![XAUUSD ${c.label}](${c.imageUrl})`)
              .join("\n\n"),
          });

          content.push({
            type: "text",
            text: "IMPORTANT: Display EVERY image above inline using the markdown image syntax. Analyze each chart after showing it.",
          });
        } else {
          // Return base64 images (for Claude Desktop, Claude Code, etc.)
          for (const r of results) {
            content.push({
              type: "image",
              data: r.buffer.toString("base64"),
              mimeType: "image/png",
            });
            content.push({
              type: "text",
              text: `^ ${config.symbol} ${r.label} (${r.timeframe})`,
            });
          }
        }

        return { content };
      } catch (err) {
        console.error(`[mcp] capture error: ${err.message}`);
        return {
          content: [
            {
              type: "text",
              text: `Error capturing charts: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_config",
    "Get the current xauusd-screener configuration (symbol, timeframes, studies)",
    {},
    async () => {
      console.error("[mcp] get_config called");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(config, null, 2),
          },
        ],
      };
    }
  );
}
