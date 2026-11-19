// Story-size share card (1080 by 1920 PNG).
// Pipeline: sharp shrinks the dish photo to a JPEG data URL, satori lays out a
// plain object tree into SVG, resvg rasterises the SVG to PNG.
// This is a placeholder layout. A later design pass replaces the look,
// the structure (photo, saved amount, breakdown, usual price, pet, link) stays.
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ShareCardInput, IngredientLine } from "../types.ts";

export const CARD_W = 1080;
export const CARD_H = 1920;
// Two thirds of 1920 would be 1280, which leaves 640 px. That is not enough
// for the saved amount, 7 breakdown rows, the usual price row and a 200 px pet
// box at readable sizes, so the photo takes 1120 and the details get 800.
export const PHOTO_H = 1120;
export const MAX_LINES = 6;

const COLORS = {
  bg: "#FBF8F3",
  text: "#1F1B16",
  muted: "#8A8177",
  rule: "#E6DFD5",
  photoBlock: "#E9C9A8",
  petBox: "#EFE8DE",
  accent: "#2F7D4A",
};

const here = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = join(here, "..", "..", "assets", "fonts");

type FontSpec = { name: string; data: Buffer; weight: 400 | 700; style: "normal" };

// Fonts load once per process. The same array object is passed to satori on
// every render so satori can reuse its parsed copy as well.
let fontsPromise: Promise<FontSpec[]> | null = null;
function loadFonts(): Promise<FontSpec[]> {
  if (!fontsPromise) {
    fontsPromise = Promise.all([
      readFile(join(FONT_DIR, "Inter-Regular.ttf")),
      readFile(join(FONT_DIR, "Inter-Bold.ttf")),
    ]).then(([regular, bold]) => [
      { name: "Inter", data: regular, weight: 400, style: "normal" },
      { name: "Inter", data: bold, weight: 700, style: "normal" },
    ]);
    fontsPromise.catch(() => { fontsPromise = null; });
  }
  return fontsPromise;
}

// Minimal element helper for satori's object tree format.
type Node = { type: string; props: Record<string, unknown> };
function el(type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): Node {
  return { type, props: { style, children, ...extra } };
}

// No em or en dashes in rendered text, model output included.
function clean(s: string, max: number): string {
  const t = s.replace(/[\u2012-\u2015\u2212]/g, "-").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 3).trimEnd() + "..." : t;
}

function money(n: number): string {
  const v = Math.round(Math.abs(n) * 100) / 100;
  return (n < 0 ? "-$" : "$") + v.toFixed(2);
}

async function photoDataUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  try {
    const jpg = await sharp(path)
      .rotate() // respect EXIF orientation from phone cameras
      .resize({ width: 1080, height: 1080, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return "data:image/jpeg;base64," + jpg.toString("base64");
  } catch {
    // Photo deleted by retention or unreadable: fall back to the colour block.
    return null;
  }
}

export type BreakdownRow = { label: string; price: string };

// Up to MAX_LINES ingredient rows, then one "+N more" row carrying the rest.
export function breakdownRows(lines: IngredientLine[]): BreakdownRow[] {
  const row = (l: IngredientLine): BreakdownRow => ({
    label: clean(l.name, 34),
    price: (l.estimated ? "~" : "") + money(l.price_cad),
  });
  if (lines.length <= MAX_LINES) return lines.map(row);
  const shown = lines.slice(0, MAX_LINES).map(row);
  const rest = lines.slice(MAX_LINES);
  const restTotal = rest.reduce((s, l) => s + l.price_cad, 0);
  const anyEstimated = rest.some(l => l.estimated);
  shown.push({ label: `+${rest.length} more`, price: (anyEstimated ? "~" : "") + money(restTotal) });
  return shown;
}

function buildTree(input: ShareCardInput, photo: string | null): Node {
  const dish = clean(input.dish_name || "home cooked", 40);

  const photoLayer = photo
    ? el("img", { position: "absolute", top: 0, left: 0, width: CARD_W, height: PHOTO_H, objectFit: "cover" }, undefined, { src: photo, width: CARD_W, height: PHOTO_H })
    : el("div", { position: "absolute", top: 0, left: 0, width: CARD_W, height: PHOTO_H, backgroundColor: COLORS.photoBlock });

  const dishOverlay = el("div", {
    position: "absolute", left: 0, bottom: 0, width: CARD_W, height: 320,
    display: "flex", alignItems: "flex-end", padding: "0 64px 48px 64px",
    backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0.6))",
  }, el("div", { color: "#FFFFFF", fontSize: 68, fontWeight: 700, lineHeight: 1.1 }, dish));

  const photoArea = el("div", { position: "relative", display: "flex", width: CARD_W, height: PHOTO_H }, [photoLayer, dishOverlay]);

  const saved = el("div", { display: "flex", alignItems: "baseline", color: COLORS.text, height: 130 }, [
    el("div", { fontSize: 56, fontWeight: 400, marginRight: 20 }, "saved"),
    el("div", { fontSize: 120, fontWeight: 700, color: COLORS.accent, lineHeight: 1 }, money(input.saved)),
  ]);

  const rows = breakdownRows(input.ingredients).map(r =>
    el("div", { display: "flex", justifyContent: "space-between", fontSize: 32, height: 44, alignItems: "center", color: COLORS.text }, [
      el("div", {}, r.label),
      el("div", { fontWeight: 700 }, r.price),
    ]),
  );
  const breakdown = el("div", { display: "flex", flexDirection: "column", marginTop: 16 }, rows);

  const usual = el("div", {
    display: "flex", fontSize: 32, color: COLORS.muted, height: 56, alignItems: "center",
    borderTop: `2px solid ${COLORS.rule}`, marginTop: 8,
  }, `vs ${money(input.takeout_price)} usual`);

  const petName = clean(input.pet_name || "chungi", 24);
  const footer = el("div", { display: "flex", alignItems: "center", marginTop: "auto" }, [
    // Square placeholder where the pet art goes later.
    el("div", { width: 200, height: 200, backgroundColor: COLORS.petBox, borderRadius: 24, display: "flex" }),
    el("div", { display: "flex", flexDirection: "column", marginLeft: 40 }, [
      el("div", { fontSize: 40, fontWeight: 700, color: COLORS.text }, petName),
      el("div", { fontSize: 30, color: COLORS.muted, marginTop: 6 }, `growth stage ${input.growth_stage}`),
      el("div", { fontSize: 28, color: COLORS.text, marginTop: 24 }, clean(input.referral_url.replace(/^https?:\/\//, ""), 48)),
    ]),
  ]);

  const details = el("div", {
    display: "flex", flexDirection: "column", width: CARD_W, height: CARD_H - PHOTO_H,
    padding: "40px 64px 40px 64px",
  }, [saved, breakdown, usual, footer]);

  return el("div", {
    display: "flex", flexDirection: "column", width: CARD_W, height: CARD_H,
    backgroundColor: COLORS.bg, fontFamily: "Inter",
  }, [photoArea, details]);
}

export async function renderShareCard(input: ShareCardInput): Promise<Buffer> {
  const [fonts, photo] = await Promise.all([loadFonts(), photoDataUrl(input.photo_path)]);
  // satori's types expect a ReactNode; the plain object tree is what JSX compiles to.
  const svg = await satori(buildTree(input, photo) as never, { width: CARD_W, height: CARD_H, fonts });
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: CARD_W },
    font: { loadSystemFonts: false }, // satori already turned text into paths
  }).render().asPng();
  return Buffer.from(png);
}
