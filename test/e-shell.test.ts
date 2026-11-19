import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { track, EVENTS } from "../web/src/analytics.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("PWA shell", () => {
  it("manifest has the fields iOS and Android need", () => {
    const m = JSON.parse(read("web/public/manifest.webmanifest"));
    expect(m.name).toBe("chungi");
    expect(m.short_name).toBe("chungi");
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(["192x192", "512x512"]);
  });

  it("index.html has viewport-fit, apple icon and no hard-coded analytics", () => {
    const html = read("web/index.html");
    expect(html).toContain("viewport-fit=cover");
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).not.toContain("data-website-id");
  });

  it("service worker is versioned and skips /api", () => {
    const sw = read("web/public/sw.js");
    expect(sw).toMatch(/const VERSION = "v\d+";/);
    expect(sw).toContain('url.pathname.startsWith("/api")');
  });
});

describe("analytics", () => {
  afterEach(() => {
    delete (globalThis as { umami?: unknown }).umami;
  });

  it("no-ops when umami is absent", () => {
    expect(() => track(EVENTS.appOpen)).not.toThrow();
  });

  it("forwards to umami when present", () => {
    const calls: unknown[] = [];
    (globalThis as { umami?: unknown }).umami = { track: (...a: unknown[]) => calls.push(a) };
    track(EVENTS.firstMealLogged, { saved: 12 });
    expect(calls).toEqual([["first_meal_logged", { saved: 12 }]]);
  });
});
