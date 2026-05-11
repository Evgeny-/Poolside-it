<script lang="ts">
  import KeyValueGrid from "./KeyValueGrid.svelte";
  import DetailsBlock from "./DetailsBlock.svelte";

  let {
    step
  }: {
    step: any;
  } = $props();
</script>

<div class="grid gap-4">
  <KeyValueGrid items={[
    ["Strategy", step?.recovery?.strategy || ""],
    ["Attempt", step?.recovery?.attempt ? `${step.recovery.attempt}/${step.recovery.maxAttempts || ""}` : ""],
    ["Summary", step?.recovery?.summary || ""],
    ["Error", step?.error?.message || ""]
  ]} />

  {#if step?.modelRequest}
    <DetailsBlock label="Model request context" value={step.modelRequest} />
  {/if}
  {#if step?.rawModelText}
    <DetailsBlock label="Raw model text" value={step.rawModelText} />
  {/if}
</div>
