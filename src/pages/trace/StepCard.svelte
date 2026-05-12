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

<article id={`step-${step?.step}`} class="grid gap-4 rounded-[16px] border border-foreground/[0.08] bg-background p-4">
  <header class="flex items-start justify-between gap-3">
    <h3 class="min-w-0 break-words text-base font-medium">{step?.step}. {step?.tool || step?.type}</h3>
    <span class="font-mono-ui shrink-0 rounded-full bg-foreground/[0.04] px-2.5 py-1 text-xs font-medium text-muted-foreground">
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
