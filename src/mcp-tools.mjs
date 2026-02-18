import { z } from "zod";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const capture = require("./capture.js");
const config = require("./config.js");

const MCP_VIEWPORT = { width: 1280, height: 800 };

/**
 * Register all xauusd-screener tools on the given McpServer instance.
 */
export function registerTools(server) {
  server.tool(
    "capture_charts",
    "Capture XAUUSD multi-timeframe chart screenshots from TradingView with SMA/EMA indicators",
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
        const results = await capture({
          timeframes,
          viewport: MCP_VIEWPORT,
          returnBuffers: true,
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
          text: `Captured ${results.length} XAUUSD chart(s): ${results.map((r) => r.label).join(", ")}\nStudies: ${config.studies.map((s) => `${s.id} (length=${s.inputs.length})`).join(", ")}\nViewport: ${MCP_VIEWPORT.width}x${MCP_VIEWPORT.height}`,
        });

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
