import { describe, it, expect, afterEach } from "vitest";
import {
  normaliseName, convertQuantity, priceIngredients, resetPriceCache,
  UNMATCHED_ESTIMATE_CAD, FALLBACK_TABLE, type PriceRow,
} from "../server/analysis/pricing.ts";

afterEach(() => resetPriceCache([]));

describe("normaliseName", () => {
  it("lowercases, strips prep words and singularises", () => {
    expect(normaliseName("Fresh Chopped Tomatoes")).toBe("tomato");
    expect(normaliseName("cooked white rice")).toBe("white rice");
    expect(normaliseName("Eggs")).toBe("egg");
    expect(normaliseName("berries")).toBe("berry");
    expect(normaliseName("green peas")).toBe("green pea");
  });
});

describe("convertQuantity", () => {
  it("passes through the same unit", () => {
    expect(convertQuantity(85, "g", "g", "tuna")).toBe(85);
  });
  it("converts cups of rice to grams with the rice density", () => {
    expect(convertQuantity(1, "cup", "g", "white rice")).toBe(185);
  });
  it("uses the default density for unknown solids", () => {
    expect(convertQuantity(1, "cup", "g", "mystery thing")).toBe(150);
  });
  it("converts tbsp to ml and cups to ml exactly", () => {
    expect(convertQuantity(2, "tbsp", "ml", "olive oil")).toBe(30);
    expect(convertQuantity(0.5, "cup", "ml", "milk")).toBe(120);
  });
  it("converts eggs between each and grams", () => {
    expect(convertQuantity(2, "each", "g", "egg")).toBe(100);
    expect(convertQuantity(100, "g", "each", "egg")).toBe(2);
  });
  it("returns null for an unknown unit", () => {
    expect(convertQuantity(1, "pinch", "g", "salt")).toBeNull();
  });
});

describe("priceIngredients", () => {
  it("uses the fallback table when prices.json is empty", () => {
    resetPriceCache([]);
    const { lines, total } = priceIngredients([
      { name: "canned tuna", quantity: 85, unit: "g" },
      { name: "whole wheat bread", quantity: 2, unit: "slice" },
    ]);
    expect(lines[0]).toMatchObject({ matched_id: "canned_tuna", estimated: false, price_cad: 0.89 });
    expect(lines[1]).toMatchObject({ matched_id: "bread_white", estimated: false, price_cad: 0.3 });
    expect(total).toBe(1.19);
  });

  it("prefers rows from prices.json over the fallback", () => {
    const row: PriceRow = {
      id: "canned_tuna_c", name: "canned tuna", aliases: ["tuna"], unit: "g",
      price_per_unit_cad: 0.02, source: "test", checked_on: "2026-10-07",
    };
    resetPriceCache([row]);
    const { lines } = priceIngredients([{ name: "Tuna", quantity: 100, unit: "g" }]);
    expect(lines[0]).toMatchObject({ matched_id: "canned_tuna_c", price_cad: 2 });
  });

  it("matches on a trailing word when the full name is unknown", () => {
    const { lines } = priceIngredients([{ name: "jasmine fried rice", quantity: 1, unit: "cup" }]);
    expect(lines[0].matched_id).toBe("white_rice");
  });

  it("estimates unmatched items at the flat rate", () => {
    const { lines, total } = priceIngredients([
      { name: "dragonfruit", quantity: 1, unit: "each" },
      { name: "egg", quantity: 2, unit: "each" },
    ]);
    expect(lines[0]).toEqual({ name: "dragonfruit", quantity: 1, unit: "each", price_cad: UNMATCHED_ESTIMATE_CAD, estimated: true });
    expect(lines[1].matched_id).toBe("egg");
    expect(total).toBe(Math.round((UNMATCHED_ESTIMATE_CAD + 0.76) * 100) / 100);
  });

  it("has about 25 fallback staples with unique ids", () => {
    expect(FALLBACK_TABLE.length).toBeGreaterThanOrEqual(24);
    expect(new Set(FALLBACK_TABLE.map(r => r.id)).size).toBe(FALLBACK_TABLE.length);
  });
});
