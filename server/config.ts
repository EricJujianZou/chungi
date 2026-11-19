// Runtime config. Secrets come from the environment (see .env.example).
// Never log process.env.
export const config = {
  port: Number(process.env.PORT ?? 3090),
  publicUrl: process.env.PUBLIC_URL ?? "http://localhost:3090",
  landingUrl: process.env.LANDING_URL ?? "https://chungi.ugmi.ca",
  // Extra origins allowed to POST /api/signup, comma separated. The landing
  // URL and localhost are always allowed.
  signupOrigins: (process.env.SIGNUP_ORIGINS ?? "").split(",").map(s => s.trim()).filter(Boolean),
  // Taken from OpenAI's public model docs (smallest current model with image
  // input). Run scripts/pick-model.ts with your key to check it.
  openaiModel: process.env.OPENAI_MODEL || "gpt-6-luna",
  dailyPhotoLimit: Number(process.env.DAILY_PHOTO_LIMIT ?? 20),
  dailySpendCapUsd: Number(process.env.DAILY_SPEND_CAP_USD ?? 5),
  fallbackIngredientEstimate: 4.0,                        // CAD
  photoRetentionHours: 24,
};
