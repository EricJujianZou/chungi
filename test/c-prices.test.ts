// Runs the price table checks from scripts/check-prices.ts under vitest.
import { describe, expect, it } from "vitest";
import { checkPrices, loadPrices } from "../scripts/check-prices.ts";

describe("data/prices.json", () => {
  const data = loadPrices() as any[];
  const result = checkPrices(data);

  it("matches the schema, has unique snake_case ids and plausible prices", () => {
    expect(result.errors).toEqual([]);
  });

  it("has around 150 or more items", () => {
    expect(result.count).toBeGreaterThanOrEqual(140);
  });

  it("prices canned tuna per gram, not per can", () => {
    const tuna = data.find((r) => r.id === "canned_tuna");
    expect(tuna.unit).toBe("g");
    expect(tuna.price_per_unit_cad).toBeGreaterThan(0.005);
    expect(tuna.price_per_unit_cad).toBeLessThan(0.02);
  });

  it("covers the staples a student cooks with", () => {
    const ids = new Set(data.map((r) => r.id));
    for (const id of ["eggs", "white_rice", "instant_noodles", "chicken_thigh", "onion", "garlic", "soy_sauce", "green_onion", "kimchi"]) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it("knows scallion and spring onion as green onion", () => {
    const g = data.find((r) => r.id === "green_onion");
    expect(g.aliases).toEqual(expect.arrayContaining(["scallion", "spring onion"]));
  });

  it("flags a pack price entered as a unit price", () => {
    const bad = [{ ...data[0], id: "bad_row", price_per_unit_cad: 1.99, unit: "g" }];
    expect(checkPrices(bad).errors.length).toBeGreaterThan(0);
  });

  it("flags duplicate and non snake_case ids", () => {
    const bad = [data[0], { ...data[0] }, { ...data[1], id: "Bad-Id" }];
    const errs = checkPrices(bad).errors.join("\n");
    expect(errs).toMatch(/duplicate id/);
    expect(errs).toMatch(/snake_case/);
  });
});
