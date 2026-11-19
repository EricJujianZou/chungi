// Photo cleanup. Meal photos are deleted config.photoRetentionHours after the
// meal was logged unless the user kept the photo. The meal row stays; only
// the file goes and photo_path becomes null.
import { unlink } from "node:fs/promises";
import { db } from "./db.ts";
import { config } from "./config.ts";

export async function purgeOldPhotos(): Promise<number> {
  const rows = db.prepare(`
    SELECT id, photo_path FROM meal
    WHERE keep_photo = 0 AND photo_path IS NOT NULL
      AND created_at <= datetime('now', ?)
  `).all(`-${config.photoRetentionHours} hours`) as { id: number; photo_path: string }[];
  let deleted = 0;
  for (const r of rows) {
    try {
      await unlink(r.photo_path);
    } catch (err) {
      // Already gone is fine; anything else, leave the row so the next run retries.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error(`retention: could not delete photo for meal ${r.id}:`, (err as Error).message);
        continue;
      }
    }
    db.prepare("UPDATE meal SET photo_path = NULL WHERE id = ? AND keep_photo = 0").run(r.id);
    deleted++;
  }
  return deleted;
}

const HOUR = 60 * 60 * 1000;

if (process.env.NODE_ENV !== "test") {
  const run = () => purgeOldPhotos().catch(err => console.error("retention run failed:", err?.message ?? err));
  run();
  setInterval(run, HOUR).unref();
}
