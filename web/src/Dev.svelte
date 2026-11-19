<script lang="ts">
  // Dev harness for testing the API from a phone. Not a product screen.
  import { api, resizePhoto, type ApiResult } from "./api";

  let output = $state("press a button");
  let busy = $state<string | null>(null);
  let lastMealId = $state<number | null>(null);

  function show(label: string, r: ApiResult) {
    // The server's SPA fallback answers unknown /api paths with index.html,
    // so an HTML body also means the route is not built yet.
    const html = /^\s*<!doctype html/i.test(r.text);
    const body = r.data !== null ? JSON.stringify(r.data, null, 2) : html ? "" : r.text || "(empty body)";
    const note =
      r.status === 404 || html ? "\n(this route is not built yet)" : "";
    output = `${label}\nstatus ${r.status}${note}\n\n${body}`;
  }

  async function run(label: string, fn: () => Promise<ApiResult>) {
    busy = label;
    output = `${label}\nwaiting for the server`;
    try {
      show(label, await fn());
    } finally {
      busy = null;
    }
  }

  async function onPhoto(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    busy = "photo";
    output = "";
    try {
      const small = await resizePhoto(file);
      const r = await api.postMeal(small);
      const id = (r.data as { id?: number } | null)?.id;
      if (typeof id === "number") lastMealId = id;
      show(`POST /api/meals (${Math.round(small.size / 1024)} KB sent)`, r);
    } finally {
      busy = null;
      input.value = "";
    }
  }

  let spend = $state("18");
  let source = $state("uber_eats");
  let cosmeticId = $state("");

  const buttons: [string, () => Promise<ApiResult>][] = [
    ["GET /api/health", api.health],
    ["GET /api/me", api.me],
    ["GET /api/comparison", api.comparison],
    ["GET /api/meals", api.meals],
    ["GET /api/wallet", api.wallet],
    ["GET /api/cosmetics", api.cosmetics],
    ["GET /api/friends", api.friends],
    ["POST /api/checkin cooking", () => api.checkin("cooking")],
    ["POST /api/checkin ordering", () => api.checkin("ordering")],
    ["POST /api/timer/start", api.timerStart],
    ["POST /api/timer/stop", api.timerStop],
  ];
</script>

<div class="dev">
  <h1>chungi dev harness</h1>

  <label class="photo">
    Take a meal photo (POST /api/meals)
    <input type="file" accept="image/*" capture="environment" onchange={onPhoto} disabled={busy !== null} />
  </label>

  {#if busy === "photo"}
    <div class="progress" role="status">
      <div class="bar"><div class="slide"></div></div>
      <p>looking at your plate</p>
    </div>
  {/if}

  {#each buttons as [label, fn]}
    <button disabled={busy !== null} onclick={() => run(label, fn)}>{label}</button>
  {/each}

  <fieldset>
    <legend>PUT /api/comparison</legend>
    <input bind:value={source} placeholder="usual_source" />
    <input bind:value={spend} inputmode="decimal" placeholder="usual_spend" />
    <button
      disabled={busy !== null}
      onclick={() =>
        run("PUT /api/comparison", () =>
          api.setComparison({ usual_source: source, usual_spend: Number(spend) })
        )}>send</button
    >
  </fieldset>

  <fieldset>
    <legend>POST /api/cosmetics/:id/buy</legend>
    <input bind:value={cosmeticId} placeholder="cosmetic id" />
    <button
      disabled={busy !== null || !cosmeticId}
      onclick={() => run("buy cosmetic", () => api.buyCosmetic(cosmeticId))}>buy</button
    >
  </fieldset>

  {#if lastMealId !== null}
    <a href={api.cardUrl(lastMealId)} target="_blank" rel="noopener">open share card for meal {lastMealId}</a>
  {/if}

  {#if busy && busy !== "photo"}
    <div class="progress" role="status">
      <div class="bar"><div class="slide"></div></div>
    </div>
  {/if}

  <pre>{output}</pre>
</div>

<style>
  .dev {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px;
    max-width: 480px;
  }
  h1 {
    font-size: 18px;
    margin: 0 0 8px;
  }
  button,
  input {
    font: inherit;
    padding: 10px;
  }
  .photo {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px;
    border: 1px solid #999;
  }
  fieldset {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  pre {
    white-space: pre-wrap;
    word-break: break-word;
    background: #fff;
    border: 1px solid #ccc;
    padding: 8px;
    font-size: 12px;
    min-height: 120px;
  }
  .progress p {
    margin: 4px 0 0;
  }
  .bar {
    position: relative;
    height: 4px;
    overflow: hidden;
    background: #ddd;
  }
  .slide {
    position: absolute;
    height: 100%;
    width: 40%;
    background: #333;
    animation: slide 1.1s ease-in-out infinite;
  }
  @keyframes slide {
    from {
      left: -40%;
    }
    to {
      left: 100%;
    }
  }
</style>
