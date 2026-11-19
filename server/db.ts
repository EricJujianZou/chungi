import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const VAR_DIR = process.env.CHUNGI_VAR ?? join(here, "..", "var");
export const PHOTO_DIR = join(VAR_DIR, "photos");
mkdirSync(PHOTO_DIR, { recursive: true });

export const db = new DatabaseSync(process.env.CHUNGI_DB ?? join(VAR_DIR, "chungi.sqlite"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
db.exec(readFileSync(join(here, "schema.sql"), "utf8"));

// Optional numbered migrations: server/migrations/001-name.sql, applied in order, idempotent.
const migDir = join(here, "migrations");
if (existsSync(migDir)) {
  for (const f of readdirSync(migDir).filter(f => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(migDir, f), "utf8"));
  }
}
