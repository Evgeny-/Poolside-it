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

<div class="flex flex-wrap gap-1.5">
  {#each visibleItems as [label, value]}
    <span class="inline-flex min-h-6 max-w-full items-center gap-1 rounded-full border border-foreground/[0.06] bg-foreground/[0.025] px-2.5 text-xs text-muted-foreground">
      <span class="font-medium text-muted-foreground/75">{label}</span>
      <span class="min-w-0 truncate font-medium text-foreground">{value}</span>
    </span>
  {/each}
</div>
