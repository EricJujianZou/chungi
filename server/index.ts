import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { config } from "./config.ts";
import "./db.ts";
import "./retention.ts"; // A1: hourly photo cleanup, off under NODE_ENV=test

export const app = new Hono();
app.get("/api/health", c => c.json({ ok: true, name: "chungi" }));

// Route modules register themselves here. Each file in server/routes exports
// `register(app)`. Owners add one line per file, in this list.
const routeModules: string[] = [
  "./routes/account.ts",   // A1
  "./routes/meals.ts",     // A1
  "./routes/wallet.ts",    // A1
  "./routes/cosmetics.ts", // A2
  "./routes/friends.ts",   // A2
  "./routes/signup.ts",    // A2
  "./routes/checkin.ts",   // A2
  "./routes/timer.ts",     // A2
  "./routes/card.ts",         // D
];
for (const m of routeModules) {
  const mod = await import(m);
  mod.register(app);
}

// Unknown API paths are 404s, never the SPA shell.
app.all("/api/*", c => c.json({ error: "not found" }, 404));

// Built frontend (web/dist) last, SPA fallback to index.html.
app.use("/*", serveStatic({ root: "./web/dist" }));
app.get("/*", serveStatic({ root: "./web/dist", path: "index.html" }));

if (process.env.NODE_ENV !== "test") {
  serve({ fetch: app.fetch, port: config.port }, () => console.log(`chungi on :${config.port}`));
}
