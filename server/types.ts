// Shared contracts between modules. Change only by agreement; every owner
// builds against these.

export type IngredientLine = {
  name: string;          // as the model named it, e.g. "canned tuna"
  quantity: number;      // in `unit`
  unit: string;          // g | ml | each | slice | cup | tbsp
  price_cad: number;     // priced by server/analysis/pricing.ts
  matched_id?: string;   // id in data/prices.json, absent when estimated
  estimated: boolean;    // true when no table match, pet says "roughly"
};

export type AnalysisResult = {
  confident: boolean;    // false => fallback path, ask user to name the dish
  dish_name: string | null;
  ingredients: IngredientLine[];
  ingredient_total: number;
  reaction: string;      // 1 to 2 sentences, personality rules applied
  nutrition_note: string | null;
  model_id: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  raw: unknown;          // full model JSON, stored for review
};

export type AnalysisContext = {
  account_id: number;
  usual_source: string | null;
  usual_spend: number;
  pet_name: string | null;
  recent_reactions?: string[];   // newest first, so the model varies its jokes
};

export type ShareCardInput = {
  photo_path: string | null;
  dish_name: string;
  ingredients: IngredientLine[];
  ingredient_total: number;
  takeout_price: number;
  saved: number;
  pet_name: string;
  growth_stage: number;
  referral_url: string;
};
