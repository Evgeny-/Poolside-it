<script lang="ts">
  import JsonBlock from "$lib/components/ui/JsonBlock.svelte";

  let {
    label,
    value
  }: {
    label: string;
    value: any;
  } = $props();
</script>

<details class="group rounded-lg border border-border bg-card p-3">
  <summary class="cursor-pointer text-sm font-bold text-primary">{label}</summary>
  <div class="mt-3">
    {#if typeof value === "string"}
      <pre class="max-h-96 overflow-auto rounded-lg border border-border bg-code p-3 text-xs leading-5 text-code-foreground whitespace-pre-wrap break-words">{value}</pre>
    {:else}
      <JsonBlock {value} maxHeight="max-h-96" />
    {/if}
  </div>
</details>
