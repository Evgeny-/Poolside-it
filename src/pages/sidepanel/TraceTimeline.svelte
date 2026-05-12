<script lang="ts">
  import { traceStepSummary, traceStepTitle, traceTimestamp } from "$lib/trace/format";

  let {
    trace
  }: {
    trace: any;
  } = $props();
</script>

<div class="grid gap-2">
  {#if !trace}
    <div class="rounded-lg border border-dashed border-border/80 bg-foreground/[0.02] p-3 text-sm text-muted-foreground">No trace recorded.</div>
  {:else}
    <article class="rounded-[16px] border border-foreground/[0.06] bg-foreground/[0.02] p-3">
      <div class="flex items-start justify-between gap-2 text-base font-medium">
        <span>{trace.status || "unknown"}</span>
        <span class="text-xs text-muted-foreground">{trace.taskId || ""}</span>
      </div>
      <div class="mt-1 break-words text-xs leading-5 text-muted-foreground">{trace.summary || trace.instruction || ""}</div>
    </article>
    {#each trace.steps || [] as step}
      <article class="rounded-[16px] border border-foreground/[0.06] bg-foreground/[0.02] p-3">
        <div class="flex items-start justify-between gap-2 text-base font-medium">
          <span>{traceStepTitle(step)}</span>
          <span class="text-xs text-muted-foreground">{traceTimestamp(step)}</span>
        </div>
        <div class="mt-1 break-words text-xs leading-5 text-muted-foreground">{traceStepSummary(step)}</div>
      </article>
    {/each}
  {/if}
</div>
