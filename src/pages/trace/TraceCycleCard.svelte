<script lang="ts">
  import {
    AlertTriangle,
    CheckCircle2,
    CornerDownLeft,
    Eye,
    MessageSquareText,
    MousePointerClick,
    ScrollText,
    TextCursorInput
  } from "@lucide/svelte";
  import { formatDate } from "$lib/utils";
  import {
    cycleSummary,
    cycleTimestamp,
    cycleTitle,
    findElementInSnapshot,
    formatElementLabel,
    formatStepRange,
    getCycleSnapshot,
    getToolCall,
    observationPageLabel,
    type TraceCycle
  } from "$lib/trace/cycles";
  import ActionStatusStrip from "./ActionStatusStrip.svelte";
  import DetailsBlock from "./DetailsBlock.svelte";
  import MetricRow from "./MetricRow.svelte";
  import ObservationContext from "./ObservationContext.svelte";
  import PropertyList from "./PropertyList.svelte";

  let {
    cycle,
    debug = false
  }: {
    cycle: TraceCycle;
    debug?: boolean;
  } = $props();

  let actionStep = $derived(cycle.actionStep);
  let observationStep = $derived(cycle.observationStep);
  let snapshot = $derived(getCycleSnapshot(cycle));
  let toolCall = $derived(getToolCall(actionStep));
  let targetElement = $derived(findElementInSnapshot(snapshot, toolCall.elementId));
  let summary = $derived(cycleSummary(cycle));
  let timestamp = $derived(cycleTimestamp(cycle));
  let ToolIcon = $derived(iconForTool(toolCall.tool));
  let assistantResponse = $derived(toolCall.tool === "respond_to_user" ? toolCall.text || "" : "");
  let hasDebugDetails = $derived(debug && (actionStep || observationStep || cycle.standaloneStep));
  let hasValidationDetails = $derived(
    actionStep?.validation?.ok === false ||
      actionStep?.confirmation?.required ||
      actionStep?.execution?.status === "failed" ||
      actionStep?.execution?.status === "blocked" ||
      actionStep?.execution?.error
  );

  function iconForTool(tool: string) {
    if (tool === "click_element") {
      return MousePointerClick;
    }
    if (tool === "fill_element" || tool === "clear_element" || tool === "select_option") {
      return TextCursorInput;
    }
    if (tool === "submit_form" || tool === "press_key") {
      return CornerDownLeft;
    }
    if (tool === "scroll" || tool === "read_page_text") {
      return ScrollText;
    }
    if (tool === "respond_to_user" || tool === "finish") {
      return MessageSquareText;
    }
    if (cycle.status === "failed" || cycle.status === "blocked" || cycle.status === "recovery") {
      return AlertTriangle;
    }
    if (observationStep) {
      return Eye;
    }
    return CheckCircle2;
  }

  function statusClass(status: string) {
    if (status === "failed" || status === "blocked") {
      return "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300";
    }
    if (status === "confirmed" || status === "recovery") {
      return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    }
    if (status === "ok" || status === "done") {
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    }
    return "border-foreground/[0.06] bg-foreground/[0.025] text-muted-foreground";
  }
</script>

<article id={`cycle-${cycle.cycleNumber}`} class="grid gap-3 rounded-[14px] border border-foreground/[0.08] bg-background p-4">
  <header class="flex items-start justify-between gap-3">
    <div class="flex min-w-0 gap-3">
      <div class={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border ${statusClass(cycle.status)}`}>
        <ToolIcon size={16} />
      </div>
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="min-w-0 text-base font-medium tracking-normal">
            Cycle {cycle.cycleNumber} - {cycleTitle(cycle)}
          </h3>
          <span class={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusClass(cycle.status)}`}>
            {cycle.status}
          </span>
        </div>
        {#if summary}
          <p class="mt-1 text-sm leading-5 text-muted-foreground [overflow-wrap:anywhere]">{summary}</p>
        {/if}
      </div>
    </div>
    <div class="flex shrink-0 flex-col items-end gap-1 text-right">
      <span class="font-mono-ui rounded-full bg-foreground/[0.04] px-2.5 py-1 text-xs font-medium text-muted-foreground">
        {formatDate(timestamp, { second: "2-digit" })}
      </span>
      <span class="font-mono-ui text-xs text-muted-foreground">{formatStepRange(cycle.rawStepNumbers)}</span>
    </div>
  </header>

  {#if actionStep}
    <ActionStatusStrip {cycle} />
  {/if}

  <MetricRow items={[
    ["Page", observationPageLabel(observationStep)],
    ["Elements", snapshot.elements?.length === undefined ? "" : String(snapshot.elements.length)],
    ["Text", snapshot.pageText?.length === undefined ? "" : String(snapshot.pageText.length)],
    ["Frames", snapshot.frames?.length === undefined ? "" : String(snapshot.frames.length || 1)]
  ]} />

  {#if actionStep}
    <PropertyList items={[
      ["Target", formatElementLabel(targetElement, toolCall.elementId)],
      ["Input", toolCall.tool === "fill_element" ? toolCall.text || "" : ""],
      ["Value", toolCall.value || ""],
      ["Key", toolCall.key || ""],
      ["Reason", toolCall.reason || ""],
      ["URL", actionStep.execution?.url || ""],
      ["Previous URL", actionStep.execution?.previousUrl || ""]
    ]} />
  {/if}

  {#if assistantResponse}
    <section class="grid gap-2 rounded-lg border border-foreground/[0.06] bg-foreground/[0.015] p-3">
      <h4 class="text-sm font-medium text-muted-foreground">Assistant response</h4>
      <p class="whitespace-pre-wrap text-sm leading-5 [overflow-wrap:anywhere]">{assistantResponse}</p>
    </section>
  {/if}

  {#if hasValidationDetails}
    <details class="rounded-lg border border-foreground/[0.06] bg-foreground/[0.015] p-3" open>
      <summary class="cursor-pointer text-sm font-medium text-foreground">Validation and execution</summary>
      <div class="mt-3">
        <PropertyList items={[
          ["Validation", actionStep.validation?.ok ? "ok" : actionStep.validation?.reason || ""],
          ["Preview", actionStep.preview?.status || ""],
          ["Confirmation", actionStep.confirmation?.decision || ""],
          ["Confirmation reason", actionStep.confirmation?.reason || ""],
          ["Execution", actionStep.execution?.status || ""],
          ["Execution error", actionStep.execution?.error?.message || ""]
        ]} />
      </div>
    </details>
  {/if}

  {#if observationStep}
    <ObservationContext step={observationStep} targetElementId={toolCall.elementId || ""} />
  {/if}

  {#if cycle.recoverySteps.length}
    <section class="grid gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
      <h4 class="text-sm font-medium text-amber-700 dark:text-amber-300">Recovery</h4>
      {#each cycle.recoverySteps as recovery}
        <PropertyList items={[
          ["Strategy", recovery.recovery?.strategy || ""],
          ["Summary", recovery.recovery?.summary || ""],
          ["Error", recovery.error?.message || ""]
        ]} />
      {/each}
    </section>
  {/if}

  {#if hasDebugDetails}
    <details class="rounded-lg border border-foreground/[0.06] bg-foreground/[0.015] p-3">
      <summary class="cursor-pointer text-sm font-medium text-primary">Debug details</summary>
      <div class="mt-3 grid gap-3">
        {#if actionStep?.modelRequest}
          <DetailsBlock label="Model request context" value={actionStep.modelRequest} />
        {/if}
        {#if actionStep?.rawModelText}
          <DetailsBlock label="Raw model text" value={actionStep.rawModelText} />
        {/if}
        {#if observationStep}
          <DetailsBlock label="Observation JSON" value={observationStep} />
        {/if}
        {#if actionStep}
          <DetailsBlock label="Action JSON" value={actionStep} />
        {/if}
        {#if cycle.standaloneStep}
          <DetailsBlock label="Raw step JSON" value={cycle.standaloneStep} />
        {/if}
      </div>
    </details>
  {/if}
</article>
