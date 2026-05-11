<script lang="ts">
  import Button from "$lib/components/ui/Button.svelte";

  let {
    items = [],
    initialLimit = 12,
    formatter = (item: any) => String(item ?? ""),
    ordered = false
  }: {
    items?: any[];
    initialLimit?: number;
    formatter?: (item: any) => string;
    ordered?: boolean;
  } = $props();

  let expanded = $state(false);
  let safeLimit = $derived(Math.max(0, Math.floor(initialLimit)));
  let visibleItems = $derived(expanded ? items : items.slice(0, safeLimit));
  let hasMore = $derived(items.length > safeLimit);
</script>

<div class="grid gap-2">
  {#if visibleItems.length}
    {#if ordered}
      <ol class="grid list-decimal gap-1.5 pl-5 text-sm leading-5">
        {#each visibleItems as item}
          <li class="break-words">{formatter(item)}</li>
        {/each}
      </ol>
    {:else}
      <ul class="grid list-disc gap-1.5 pl-5 text-sm leading-5">
        {#each visibleItems as item}
          <li class="break-words">{formatter(item)}</li>
        {/each}
      </ul>
    {/if}
  {:else}
    <div class="rounded-md border border-dashed border-border bg-muted/50 p-3 text-sm text-muted-foreground">None</div>
  {/if}

  {#if hasMore}
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-xs text-muted-foreground">Showing {visibleItems.length} of {items.length}</span>
      <Button size="sm" onclick={() => expanded = !expanded}>
        {expanded ? `Show first ${safeLimit}` : `Show all ${items.length}`}
      </Button>
    </div>
  {/if}
</div>
