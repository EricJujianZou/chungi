<script lang="ts">
  // Tiny history router. The server already falls back to index.html for any
  // non-API path, so real paths like /dev work on reload and in links.
  import { onMount } from "svelte";
  import Dev from "./Dev.svelte";

  let path = $state(location.pathname);

  function onClick(e: MouseEvent) {
    const a = (e.target as Element | null)?.closest("a");
    if (!a || a.target || a.origin !== location.origin || a.pathname.startsWith("/api")) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    history.pushState(null, "", a.pathname + a.search);
    path = a.pathname;
  }

  onMount(() => {
    const onPop = () => (path = location.pathname);
    addEventListener("popstate", onPop);
    document.addEventListener("click", onClick);
    return () => {
      removeEventListener("popstate", onPop);
      document.removeEventListener("click", onClick);
    };
  });
</script>

{#if path === "/dev"}
  <Dev />
{:else}
  <main>
    <p>chungi is being built.</p>
  </main>
{/if}

<style>
  :global(body) {
    margin: 0;
    font-family: system-ui, sans-serif;
    background: #f4efe6;
    color: #1d1d1d;
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
      env(safe-area-inset-left);
  }
  main {
    padding: 16px;
  }
</style>
