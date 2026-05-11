<script lang="ts">
  let {
    items = []
  }: {
    items?: [string, any][];
  } = $props();
</script>

<div class="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2">
  {#each items as [label, value]}
    <div class="rounded-lg border border-border bg-muted/60 p-3">
      <div class="text-[11px] font-extrabold uppercase tracking-normal text-muted-foreground">{label}</div>
      <div class="mt-1 break-words text-sm">{value || ""}</div>
    </div>
  {/each}
</div>
