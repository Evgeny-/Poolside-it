<script lang="ts">
  import Button from "$lib/components/ui/Button.svelte";

  let {
    pending,
    onApprove,
    onReject
  }: {
    pending: any;
    onApprove: () => void;
    onReject: () => void;
  } = $props();
</script>

{#if pending}
  <section class="mx-3 mb-3 grid gap-2 rounded-xl border border-warning bg-warning/20 p-3">
    <div>
      <h2 class="text-sm font-bold text-warning-foreground">{pending.title}</h2>
      <p class="mt-1 text-xs leading-5 text-warning-foreground/80">{pending.reason}</p>
    </div>
    <div class="flex flex-wrap gap-1.5">
      {#each pending.meta || [] as item}
        {#if item}
          <span class="rounded-full border border-warning/60 bg-card/70 px-2 py-0.5 text-[11px] font-bold text-warning-foreground">{item}</span>
        {/if}
      {/each}
    </div>
    <div class="flex justify-end gap-2">
      <Button size="sm" onclick={onReject}>Cancel</Button>
      <Button size="sm" variant="primary" onclick={onApprove}>Approve</Button>
    </div>
  </section>
{/if}
