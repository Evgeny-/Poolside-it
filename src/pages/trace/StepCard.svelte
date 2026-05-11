<script lang="ts">
  import { formatDate } from "$lib/utils";
  import DetailsBlock from "./DetailsBlock.svelte";
  import ModelActionStep from "./ModelActionStep.svelte";
  import ObservationStep from "./ObservationStep.svelte";
  import RecoveryStep from "./RecoveryStep.svelte";

  let {
    step
  }: {
    step: any;
  } = $props();
</script>

<article id={`step-${step?.step}`} class="grid gap-4 rounded-xl border border-border bg-card p-4 shadow-panel">
  <header class="flex items-start justify-between gap-3">
    <h3 class="min-w-0 break-words text-base font-bold">{step?.step}. {step?.tool || step?.type}</h3>
    <span class="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-bold text-muted-foreground">
      {formatDate(step?.timestamp, { second: "2-digit" })}
    </span>
  </header>

  {#if step?.type === "observe"}
    <ObservationStep {step} />
  {:else if step?.type === "model_action"}
    <ModelActionStep {step} />
  {:else if step?.type === "recovery"}
    <RecoveryStep {step} />
  {/if}

  <DetailsBlock label="Raw step JSON" value={step} />
</article>
