<script lang="ts">
  import { Bug, Copy, FileJson2, ListTree } from "@lucide/svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import { STORAGE_KEYS } from "$extension/shared/protocol.js";
  import { createCompactTraceExport } from "$extension/shared/trace-export.js";
  import { formatDate } from "$lib/utils";
  import { formatConfirmationMode, stepNavLabel } from "$lib/trace/format";
  import { buildTraceCycles, cycleSummary, cycleTitle } from "$lib/trace/cycles";
  import MetricRow from "./MetricRow.svelte";
  import PropertyList from "./PropertyList.svelte";
  import StepCard from "./StepCard.svelte";
  import TraceCycleCard from "./TraceCycleCard.svelte";

  const params = new URLSearchParams(location.search);
  const taskId = params.get("taskId");

  let trace = $state<any>(null);
  let error = $state("");
  let copyCompactLabel = $state("Copy JSON");
  let copyFullLabel = $state("Copy full JSON");
  let debugMode = $state(false);
  let rawStepMode = $state(false);

  let cycles = $derived(buildTraceCycles(trace));

  $effect(() => {
    loadTrace();
    const listener = (changes: any, areaName: string) => {
      if (areaName !== "local" || !changes[STORAGE_KEYS.TASK_TRACES]) {
        return;
      }
      setTraceFromList(changes[STORAGE_KEYS.TASK_TRACES].newValue || []);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  });

  async function loadTrace() {
    if (!taskId) {
      error = "No taskId provided.";
      return;
    }

    const stored = await chrome.storage.local.get({
      [STORAGE_KEYS.TASK_TRACES]: []
    });
    setTraceFromList(stored[STORAGE_KEYS.TASK_TRACES] || []);
  }

  function setTraceFromList(traces: any[]) {
    const nextTrace = traces.find((candidate: any) => candidate.taskId === taskId);
    if (!nextTrace) {
      if (!trace) {
        error = "Trace not found. It may have been capped out of local storage.";
      }
      return;
    }

    error = "";
    trace = nextTrace;
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

  function statusClass(status: string) {
    if (status === "failed" || status === "aborted" || status === "stopped") {
      return "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300";
    }
    if (status === "running") {
      return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    }
    if (status === "completed") {
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    }
    return "border-foreground/[0.06] bg-foreground/[0.025] text-muted-foreground";
  }

  function formatDuration(start: string, end: string) {
    if (!start || !end) {
      return "";
    }
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
      return "";
    }
    const seconds = Math.round((endMs - startMs) / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `${minutes}m ${remainder}s`;
  }

  function navCycleSummary(cycle: any) {
    return cycleSummary(cycle) || cycleTitle(cycle);
  }
</script>

<div class="min-h-screen bg-surface text-foreground">
  <header class="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border/70 bg-surface/95 px-5 py-3 backdrop-blur">
    <div class="min-w-0">
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <h1 class="truncate text-xl font-semibold tracking-normal">Run Details</h1>
        {#if trace?.status}
          <span class={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusClass(trace.status)}`}>{trace.status}</span>
        {/if}
      </div>
      <div class="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {#if error}
          <span>{error}</span>
        {:else if trace}
          <span class="max-w-full truncate">{trace.taskId}</span>
          <span>{trace.model}</span>
          <span>{trace.steps?.length || 0} raw steps</span>
          <span>{cycles.length} cycles</span>
          {#if formatDuration(trace.createdAt, trace.completedAt)}
            <span>{formatDuration(trace.createdAt, trace.completedAt)}</span>
          {/if}
        {:else}
          <span>Loading</span>
        {/if}
      </div>
    </div>
    <div class="flex flex-wrap justify-end gap-2">
      <Button disabled={!trace} onclick={() => debugMode = !debugMode}>
        <Bug size={15} />
        {debugMode ? "Debug on" : "Debug"}
      </Button>
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
      <div class="rounded-[16px] border border-foreground/[0.08] bg-background p-5 text-sm text-muted-foreground">{error}</div>
    </main>
  {:else if trace}
    <main class="mx-auto grid w-[min(1420px,calc(100%-32px))] grid-cols-[250px_minmax(0,1fr)] items-start gap-4 py-5 max-[820px]:grid-cols-1">
      <aside class="sticky top-20 self-start overflow-hidden rounded-[14px] border border-foreground/[0.08] bg-background max-[820px]:static">
        <div class="border-b border-foreground/[0.06] px-3 py-2.5">
          <h2 class="text-sm font-medium text-muted-foreground">{debugMode && rawStepMode ? "Raw steps" : "Cycles"}</h2>
        </div>
        <nav class="flex max-h-[calc(100vh-132px)] flex-col gap-1 overflow-auto p-2 max-[820px]:max-h-72" aria-label="Trace navigation">
          {#if debugMode && rawStepMode}
            {#each trace.steps || [] as step}
              <a class="rounded-md px-2.5 py-2 text-sm leading-5 text-foreground no-underline transition-colors hover:bg-foreground/[0.04]" href={`#step-${step.step}`}>
                <span class="font-mono-ui text-xs text-muted-foreground">{step.step}</span>
                <span class="ml-1">{stepNavLabel(step)}</span>
              </a>
            {/each}
          {:else}
            {#each cycles as cycle}
              <a class="grid gap-0.5 rounded-md px-2.5 py-2 text-sm leading-5 text-foreground no-underline transition-colors hover:bg-foreground/[0.04]" href={`#cycle-${cycle.cycleNumber}`}>
                <span class="flex min-w-0 items-center justify-between gap-2">
                  <span class="min-w-0 truncate font-medium">{cycle.cycleNumber}. {cycleTitle(cycle)}</span>
                  <span class={`shrink-0 rounded-full border px-1.5 py-0.5 text-[11px] ${statusClass(cycle.status)}`}>{cycle.status}</span>
                </span>
                <span class="truncate text-xs text-muted-foreground">{navCycleSummary(cycle)}</span>
              </a>
            {/each}
          {/if}
        </nav>
      </aside>

      <div class="grid min-w-0 gap-4">
        <section class="grid gap-3 rounded-[14px] border border-foreground/[0.08] bg-background p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <h2 class="text-base font-medium">Instruction</h2>
              <p class="mt-1 whitespace-pre-wrap text-sm leading-5 text-foreground [overflow-wrap:anywhere]">{trace.instruction}</p>
            </div>
            {#if debugMode}
              <div class="flex shrink-0 flex-wrap gap-2">
                <Button size="sm" variant={rawStepMode ? "secondary" : "primary"} onclick={() => rawStepMode = false}>
                  <ListTree size={14} />
                  Cycles
                </Button>
                <Button size="sm" variant={rawStepMode ? "primary" : "secondary"} onclick={() => rawStepMode = true}>
                  Raw steps
                </Button>
              </div>
            {/if}
          </div>

          <MetricRow items={[
            ["Status", trace.status],
            ["Model", trace.model],
            ["Confirmation", formatConfirmationMode(trace.confirmationMode)],
            ["Preview", trace.actionPreview === false ? "off" : "on"],
            ["Raw steps", String(trace.steps?.length || 0)],
            ["Cycles", String(cycles.length)],
            ["Duration", formatDuration(trace.createdAt, trace.completedAt)]
          ]} />

          <PropertyList items={[
            ["Page", trace.activeTab?.title || trace.activeTab?.url || ""],
            ["Created", formatDate(trace.createdAt, { second: "2-digit" })],
            ["Completed", formatDate(trace.completedAt, { second: "2-digit" })],
            ["Summary", trace.summary || ""]
          ]} />
        </section>

        <section class="grid gap-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="text-base font-medium text-muted-foreground">{debugMode && rawStepMode ? "Raw Timeline" : "Decision Timeline"}</h2>
            {#if debugMode}
              <span class="text-xs text-muted-foreground">Debug mode keeps the raw trace available without making it the default view.</span>
            {/if}
          </div>
          <div class="grid gap-3">
            {#if debugMode && rawStepMode}
              {#each trace.steps || [] as step}
                <StepCard {step} />
              {/each}
            {:else}
              {#each cycles as cycle}
                <TraceCycleCard {cycle} debug={debugMode} />
              {/each}
            {/if}
          </div>
        </section>
      </div>
    </main>
  {/if}
</div>
