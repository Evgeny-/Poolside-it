<script lang="ts">
  let {
    items = []
  }: {
    items?: [string, any][];
  } = $props();

  let visibleItems = $derived(items.filter(([, value]) => (
    value !== null && value !== undefined && String(value) !== ""
  )));
</script>

<div class="divide-y divide-foreground/[0.06] overflow-hidden rounded-lg border border-foreground/[0.06] bg-foreground/[0.015]">
  {#each visibleItems as [label, value]}
    <div class="grid grid-cols-[112px_minmax(0,1fr)] gap-3 px-3 py-2.5 text-sm max-[640px]:grid-cols-1 max-[640px]:gap-1.5">
      <div class="text-xs font-medium text-muted-foreground/80">{label}</div>
      <div class="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{value}</div>
    </div>
  {:else}
    <div class="px-3 py-2.5 text-sm text-muted-foreground">None</div>
  {/each}
</div>
