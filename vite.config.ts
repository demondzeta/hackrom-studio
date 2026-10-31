import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

const { readState, writeCommands } = createRequire(import.meta.url)("./electron/liveBridge.cjs");

/**
 * Live link bridge for `npm run dev`. Requests must come from this app: a "lua" command runs code inside
 * FBNeo, and without this check any web page could post to localhost.
 */
function liveBridge(): Plugin {
  const dir = path.resolve(process.env.HACKROM_LIVE_DIR ?? os.tmpdir());
  const script = path.resolve("tools/live/hackrom_live.lua");
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
  return {
    name: "hackrom-live-bridge",
    configureServer(server) {
      server.middlewares.use("/__live", (req, res) => {
        const send = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify(body));
        };
        const origin = req.headers.origin;
        if (!local.test(req.headers.host ?? "") || (origin && !local.test(origin.replace(/^https?:\/\//, "")))) return send(403, { ok: false });
        if (req.method === "GET" && req.url?.startsWith("/state")) return send(200, readState(dir, script));
        if (req.method === "POST" && req.url?.startsWith("/cmd")) {
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", () => send(200, writeCommands(dir, body)));
          return;
        }
        send(404, { ok: false });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), liveBridge()],
  base: "./",
  server: { port: 5178, watch: { ignored: ["**/tools/**", "**/scripts/**"] } },
});
