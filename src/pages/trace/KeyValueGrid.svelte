<script lang="ts">
  let {
    items = []
  }: {
    items?: [string, any][];
  } = $props();
</script>

<div class="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2">
  {#each items as [label, value]}
    <div class="rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] p-3">
      <div class="text-xs font-medium text-muted-foreground/80">{label}</div>
      <div class="mt-1 break-words text-sm">{value || ""}</div>
    </div>
  {/each}
</div>
