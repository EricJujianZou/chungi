// Umami event helper. Analytics is off by default. main.ts adds the umami
// script only when VITE_UMAMI_SRC and VITE_UMAMI_WEBSITE_ID are set at build
// time. If the script is off, blocked or not loaded yet, track() does nothing.

// Funnel events. Landing views and signups are tracked on the landing page;
// the app sends the rest.
export const EVENTS = {
  landingView: "landing_view",
  signup: "signup",
  signupWithReferral: "signup_with_referral",
  appOpen: "app_open",
  onboardingCompleted: "onboarding_completed",
  firstPhotoTaken: "first_photo_taken",
  firstMealLogged: "first_meal_logged",
  shareSheetOpened: "share_sheet_opened",
  secondDayReturn: "second_day_return",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

type Umami = { track: (event: string, data?: Record<string, unknown>) => void };

export function track(event: EventName, data?: Record<string, unknown>): void {
  const umami = (globalThis as { umami?: Umami }).umami;
  if (!umami || typeof umami.track !== "function") return;
  try {
    umami.track(event, data);
  } catch {
    // analytics must never break the app
  }
}
