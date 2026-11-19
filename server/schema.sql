-- chungi schema. Add tables or columns via
-- new numbered files in server/migrations/, never edit rows here in place.
CREATE TABLE IF NOT EXISTS account (
  id            INTEGER PRIMARY KEY,
  token         TEXT NOT NULL UNIQUE,           -- cookie value, random 32 bytes hex
  pet_name      TEXT,
  growth_stage  INTEGER NOT NULL DEFAULT 0,
  phone         TEXT,
  email         TEXT,
  referral_code TEXT NOT NULL UNIQUE,            -- short, shareable
  referred_by   INTEGER REFERENCES account(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS comparison (
  account_id    INTEGER PRIMARY KEY REFERENCES account(id),
  usual_source  TEXT,                            -- uber_eats | skip | campus | boba | other
  usual_spend   REAL NOT NULL DEFAULT 18.0,      -- CAD, slider value
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS comparison_answer (   -- "what would tonight have been?"
  id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES account(id),
  amount REAL NOT NULL, asked_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS meal (
  id              INTEGER PRIMARY KEY,
  account_id      INTEGER NOT NULL REFERENCES account(id),
  photo_path      TEXT,                          -- null once deleted
  keep_photo      INTEGER NOT NULL DEFAULT 0,
  dish_name       TEXT,
  confident       INTEGER NOT NULL DEFAULT 1,    -- 0 when model could not name it
  ingredients     TEXT NOT NULL DEFAULT '[]',    -- JSON IngredientLine[]
  ingredient_total REAL NOT NULL DEFAULT 0,
  takeout_price   REAL NOT NULL,
  saved           REAL NOT NULL,
  reaction        TEXT,                          -- pet's generated line(s)
  nutrition_note  TEXT,                          -- qualitative only
  timer_seconds   INTEGER,
  model_id        TEXT, input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL,
  raw_response    TEXT,                          -- full model JSON for review
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES account(id),
  amount REAL NOT NULL,                          -- + credit, - debit
  kind TEXT NOT NULL,                            -- meal | cosmetic
  ref_id INTEGER,                                -- meal.id or cosmetic id
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS owned_cosmetic (
  account_id INTEGER NOT NULL REFERENCES account(id),
  cosmetic_id TEXT NOT NULL, worn INTEGER NOT NULL DEFAULT 0,
  bought_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, cosmetic_id)
);
CREATE TABLE IF NOT EXISTS friendship (
  a INTEGER NOT NULL REFERENCES account(id), b INTEGER NOT NULL REFERENCES account(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (a, b)
);
CREATE TABLE IF NOT EXISTS checkin (
  id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES account(id),
  answer TEXT NOT NULL,                          -- cooking | ordering
  day TEXT NOT NULL,                             -- YYYY-MM-DD local
  UNIQUE (account_id, day)
);
CREATE TABLE IF NOT EXISTS timer_session (
  id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES account(id),
  started_at TEXT NOT NULL DEFAULT (datetime('now')), stopped_at TEXT, meal_id INTEGER REFERENCES meal(id)
);
CREATE TABLE IF NOT EXISTS signup (
  id INTEGER PRIMARY KEY, email TEXT, phone TEXT, referral_code TEXT, source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS analysis_log (        -- every model call, for review and cost
  id INTEGER PRIMARY KEY, account_id INTEGER, meal_id INTEGER, model_id TEXT,
  input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL, ok INTEGER NOT NULL,
  error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
