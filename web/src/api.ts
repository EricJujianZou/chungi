// Thin fetch wrapper for the chungi API. The account lives in a cookie, so
// every call sends credentials. Route modules are built by other owners in
// parallel (docs/architecture.md); paths and shapes here follow that doc and
// server/schema.sql and may need small fixes once the routes land.

export type ApiResult<T = unknown> = {
  ok: boolean;
  status: number;
  data: T | null;
  text: string;
};

async function call<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  const init: RequestInit = { method, credentials: "include", headers: {} };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    (init.headers as Record<string, string>)["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (err) {
    return { ok: false, status: 0, data: null, text: String(err) };
  }
  const text = await res.text();
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data, text };
}

export type IngredientLine = {
  name: string;
  quantity: number;
  unit: string;
  price_cad: number;
  matched_id?: string;
  estimated: boolean;
};

export type Me = {
  id: number;
  pet_name: string | null;
  growth_stage: number;
  referral_code: string;
  created_at: string;
};

export type Comparison = { usual_source: string | null; usual_spend: number };

export type Meal = {
  id: number;
  dish_name: string | null;
  confident: boolean;
  ingredients: IngredientLine[];
  ingredient_total: number;
  takeout_price: number;
  saved: number;
  reaction: string | null;
  nutrition_note: string | null;
  created_at: string;
};

export type Wallet = { balance: number; ledger?: { amount: number; kind: string; created_at: string }[] };
export type Cosmetic = { id: string; name?: string; price?: number; owned?: boolean; worn?: boolean };
export type Friend = { id: number; pet_name: string | null; growth_stage?: number };

export const api = {
  health: () => call<{ ok: boolean }>("GET", "/api/health"),
  me: () => call<Me>("GET", "/api/me"),
  updateMe: (patch: Partial<Pick<Me, "pet_name">>) => call<Me>("PATCH", "/api/me", patch),
  comparison: () => call<Comparison>("GET", "/api/comparison"),
  setComparison: (c: Comparison) => call<Comparison>("PUT", "/api/comparison", c),
  postMeal: (photo: Blob, fields: Record<string, string> = {}) => {
    const form = new FormData();
    form.append("photo", photo, "meal.jpg");
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return call<Meal>("POST", "/api/meals", form);
  },
  meals: () => call<Meal[]>("GET", "/api/meals"),
  wallet: () => call<Wallet>("GET", "/api/wallet"),
  cosmetics: () => call<Cosmetic[]>("GET", "/api/cosmetics"),
  buyCosmetic: (id: string) => call("POST", `/api/cosmetics/${encodeURIComponent(id)}/buy`),
  friends: () => call<Friend[]>("GET", "/api/friends"),
  checkin: (answer: "cooking" | "ordering") => call("POST", "/api/checkin", { answer }),
  timerStart: () => call("POST", "/api/timer/start"),
  timerStop: () => call("POST", "/api/timer/stop"),
  cardUrl: (mealId: number) => `/api/card/${mealId}.png`,
};

// Resize a photo on the phone before upload so the long edge is at most
// `maxEdge` px. Falls back to the original file if the
// browser cannot decode it.
export async function resizePhoto(file: Blob, maxEdge = 1024): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob ?? file;
  } catch {
    return file;
  }
}
