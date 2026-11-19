import { mount } from "svelte";
import App from "./App.svelte";

mount(App, { target: document.getElementById("app")! });

// Analytics is off unless both values are set at build time (.env.example).
const umamiSrc = import.meta.env.VITE_UMAMI_SRC as string | undefined;
const umamiId = import.meta.env.VITE_UMAMI_WEBSITE_ID as string | undefined;
if (umamiSrc && umamiId) {
  const s = document.createElement("script");
  s.defer = true;
  s.src = umamiSrc;
  s.dataset.websiteId = umamiId;
  s.dataset.tag = "chungi";
  document.head.appendChild(s);
}

// Register the service worker in production builds only, so dev reloads are
// never served from a stale cache.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
