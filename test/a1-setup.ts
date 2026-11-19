// Shared setup for A1 tests: a temp var dir, the app, and a tiny cookie client.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function loadApp() {
  process.env.NODE_ENV = "test";
  process.env.CHUNGI_VAR = mkdtempSync(join(tmpdir(), "chungi-a1-"));
  delete process.env.CHUNGI_DB;
  const { app } = await import("../server/index.ts");
  const { db, PHOTO_DIR } = await import("../server/db.ts");
  return { app, db, PHOTO_DIR };
}

type App = Awaited<ReturnType<typeof loadApp>>["app"];

// Keeps the chungi cookie between requests, like a phone browser would.
export function client(app: App) {
  let cookie: string | null = null;
  async function req(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (cookie) headers.set("cookie", cookie);
    const res = await app.request(path, { ...init, headers });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return res;
  }
  return {
    req,
    get cookie() { return cookie; },
    json: (path: string, body: unknown) =>
      req(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  };
}

export async function tinyJpeg(): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .jpeg().toBuffer();
}

export function photoForm(buf: Buffer, extra: Record<string, string> = {}, type = "image/jpeg", name = "plate.jpg") {
  const fd = new FormData();
  fd.append("photo", new File([new Uint8Array(buf)], name, { type }));
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return fd;
}
