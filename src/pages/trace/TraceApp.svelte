<script lang="ts">
  import { Copy, FileJson2 } from "@lucide/svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import { STORAGE_KEYS } from "$extension/shared/protocol.js";
  import { createCompactTraceExport } from "$extension/shared/trace-export.js";
  import { formatDate } from "$lib/utils";
  import { formatConfirmationMode, stepNavLabel } from "$lib/trace/format";
  import KeyValueGrid from "./KeyValueGrid.svelte";
  import StepCard from "./StepCard.svelte";

  const params = new URLSearchParams(location.search);
  const taskId = params.get("taskId");

  let trace = $state<any>(null);
  let error = $state("");
  let copyCompactLabel = $state("Copy JSON");
  let copyFullLabel = $state("Copy full JSON");

  $effect(() => {
    loadTrace();
  });

  async function loadTrace() {
    if (!taskId) {
      error = "No taskId provided.";
      return;
    }

    const stored = await chrome.storage.local.get({
      [STORAGE_KEYS.TASK_TRACES]: []
    });
    trace = (stored[STORAGE_KEYS.TASK_TRACES] || [])
      .find((candidate: any) => candidate.taskId === taskId);

    if (!trace) {
      error = "Trace not found. It may have been capped out of local storage.";
      return;
    }

    document.title = `Poolside it for me Run Details - ${trace.taskId}`;
  }

  async function copyJson(value: unknown, full = false) {
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
    if (full) {
      copyFullLabel = "Copied full";
      window.setTimeout(() => copyFullLabel = "Copy full JSON", 1200);
    } else {
      copyCompactLabel = "Copied";
      window.setTimeout(() => copyCompactLabel = "Copy JSON", 1200);
    }
  }
</script>

<div class="min-h-screen bg-background text-foreground">
  <header class="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-card/95 px-5 py-4 backdrop-blur">
    <div class="min-w-0">
      <h1 class="truncate text-xl font-extrabold tracking-normal">Run Details</h1>
      <div class="mt-1 truncate text-xs text-muted-foreground">{error || `${trace?.status || "Loading"} - ${trace?.taskId || ""}`}</div>
    </div>
    <div class="flex flex-wrap justify-end gap-2">
      <Button variant="primary" disabled={!trace} onclick={() => copyJson(createCompactTraceExport(trace))}>
        <Copy size={15} />
        {copyCompactLabel}
      </Button>
      <Button disabled={!trace} onclick={() => copyJson(trace, true)}>
        <FileJson2 size={15} />
        {copyFullLabel}
      </Button>
    </div>
  </header>

  {#if error}
    <main class="mx-auto grid min-h-[50vh] w-[min(760px,calc(100%-32px))] place-items-center">
      <div class="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground shadow-panel">{error}</div>
    </main>
  {:else if trace}
    <main class="mx-auto grid w-[min(1280px,calc(100%-32px))] grid-cols-[280px_minmax(0,1fr)] gap-4 py-5 max-[820px]:grid-cols-1">
      <aside class="sticky top-24 grid max-h-[calc(100vh-112px)] gap-3 overflow-auto rounded-xl border border-border bg-card p-3 shadow-panel max-[820px]:static max-[820px]:max-h-none">
        <h2 class="text-sm font-bold">Steps</h2>
        <nav class="grid gap-1" aria-label="Trace steps">
          {#each trace.steps || [] as step}
            <a class="truncate rounded-md border border-transparent px-2.5 py-2 text-sm text-foreground no-underline hover:border-border hover:bg-secondary" href={`#step-${step.step}`}>
              {step.step}. {stepNavLabel(step)}
            </a>
          {/each}
        </nav>
      </aside>

      <div class="grid min-w-0 gap-4">
        <section class="grid gap-3 rounded-xl border border-border bg-card p-4 shadow-panel">
          <h2 class="text-base font-bold">Summary</h2>
          <KeyValueGrid items={[
            ["Instruction", trace.instruction],
            ["Status", trace.status],
            ["Model", trace.model],
            ["Confirmation", formatConfirmationMode(trace.confirmationMode)],
            ["Action preview", trace.actionPreview === false ? "off" : "on"],
            ["Page", trace.activeTab?.title || trace.activeTab?.url || ""],
            ["Created", formatDate(trace.createdAt, { second: "2-digit" })],
            ["Completed", formatDate(trace.completedAt, { second: "2-digit" })],
            ["Steps", String(trace.steps?.length || 0)]
          ]} />
        </section>

        <section class="grid gap-3">
          <h2 class="text-base font-bold">Timeline</h2>
          <div class="grid gap-3">
            {#each trace.steps || [] as step}
              <StepCard {step} />
            {/each}
          </div>
        </section>
      </div>
    </main>
  {/if}
</div>
