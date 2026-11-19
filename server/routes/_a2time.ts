// Local-time helpers for America/Toronto, used by check-in (one per local day)
// and friends (saved total since Monday). Owned by A2.
export const TZ = "America/Toronto";

function parts(d: Date) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", weekday: "short",
  });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return o;
}

// YYYY-MM-DD in Toronto.
export function localDay(d = new Date()): string {
  const p = parts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

// Toronto's offset from UTC at instant `ms`, in ms (negative in Canada).
function offsetAt(ms: number): number {
  const p = parts(new Date(ms));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

// UTC instant of local midnight on a local date. Two passes handle DST.
function localMidnightUtc(y: number, m: number, d: number): Date {
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - offsetAt(guess);
  return new Date(guess - offsetAt(first));
}

// Monday 00:00 Toronto of the current week, as an SQLite UTC datetime string
// comparable with columns filled by datetime('now').
export function weekStartSql(now = new Date()): string {
  const p = parts(now);
  const dow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday);
  const base = new Date(Date.UTC(+p.year, +p.month - 1, +p.day - dow));
  const start = localMidnightUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate());
  return start.toISOString().slice(0, 19).replace("T", " ");
}
